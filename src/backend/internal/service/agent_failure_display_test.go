package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

// 使用实际捕获的 Codex 错误作为 fixture，不推测未观察到的诊断。
const routingFailure = "workspace routing discovery timed out"

func TestDispatcherFailureVisibleInTerminalEventAndHistory(t *testing.T) {
	userID := "u1"
	msgRepo := &fakeMsgRepo{}
	notifier := &fakeStreamingNotifier{}
	ch := make(chan *ws.TaskResult, 1)
	ch <- &ws.TaskResult{TaskID: "task-s", Error: routingFailure}
	hub := &fakeDaemonDispatcher{
		isConnected:         func(string) bool { return true },
		registerTaskPromise: func(string) chan *ws.TaskResult { return ch },
		sendToMachine:       func(string, ws.WSMessage) error { return nil },
		awaitTaskResult:     func(string) chan *ws.TaskResult { return ch },
		removeTaskPromise:   func(string) {},
	}
	d := buildStreamingDispatcher(t, hub, msgRepo, notifier)
	_, err := d.Dispatch(context.Background(), DispatchInput{
		ConvID: "c1", UserID: userID,
		Agent: &model.Agent{ID: "a1", Name: "Codex", CLITool: "codex", MachineID: stringPtr("m1")}, Prompt: "draw animation",
	}, DispatchHooks{})
	if err == nil {
		t.Fatal("expected original task failure")
	}
	svc := NewMessageService(msgRepo, &fakeConvRepoForMsg{conv: &model.Conversation{ID: "c1", UserID: userID, Type: "agent"}}, nil)
	history, err := svc.GetHistory(context.Background(), "c1", userID, nil, 20)
	if err != nil || len(history) != 1 {
		t.Fatalf("history: %v %+v", err, history)
	}
	assertFailureMessage(t, history[0], routingFailure)
	for _, event := range notifier.customCalls {
		if event.eventType != ws.TypeMessageComplete {
			continue
		}
		encoded, _ := json.Marshal(event.data)
		var terminal model.Message
		if err := json.Unmarshal(encoded, &terminal); err != nil {
			t.Fatal(err)
		}
		assertFailureMessage(t, terminal, routingFailure)
		if terminal.BlocksJSON != history[0].BlocksJSON {
			t.Fatal("live and refreshed error differ")
		}
		return
	}
	t.Fatal("missing terminal event")
}

// 模拟数据库已提交终态、后续读取临时不可用的外部边界。
type afterCommitReadFailureRepo struct {
	*fakeMsgRepo
	committed        bool
	readsAfterCommit int
	failAt           int
}

func (r *afterCommitReadFailureRepo) FinalizeStreaming(ctx context.Context, id, status, content, blocks, artifacts string) error {
	err := r.fakeMsgRepo.FinalizeStreaming(ctx, id, status, content, blocks, artifacts)
	if err == nil {
		r.committed = true
	}
	return err
}

func (r *afterCommitReadFailureRepo) GetByID(ctx context.Context, id string) (*model.Message, error) {
	if r.committed {
		r.readsAfterCommit++
		if r.readsAfterCommit >= r.failAt {
			return nil, errors.New("temporary database read failure")
		}
	}
	return r.fakeMsgRepo.GetByID(ctx, id)
}

func TestDispatcherCommittedFailureBroadcastsDespiteReloadFailure(t *testing.T) {
	for _, failAt := range []int{1, 2} {
		t.Run(fmt.Sprintf("read_%d", failAt), func(t *testing.T) {
			repo := &fakeMsgRepo{}
			notifier := &fakeStreamingNotifier{}
			buf := NewStreamingBuffer()
			ch := make(chan *ws.TaskResult, 1)
			hub := &fakeDaemonDispatcher{
				isConnected: func(string) bool { return true }, registerTaskPromise: func(string) chan *ws.TaskResult { return ch },
				sendToMachine: func(_ string, msg ws.WSMessage) error {
					id := msg.Data.(map[string]interface{})["task_id"].(string)
					buf.PushEvents(id, []model.AgentEvent{{Type: "text.delta", Content: "已输出的动画说明"}})
					ch <- &ws.TaskResult{TaskID: id, Error: routingFailure}
					return nil
				}, awaitTaskResult: func(string) chan *ws.TaskResult { return ch }, removeTaskPromise: func(string) {},
			}
			d := buildStreamingDispatcher(t, hub, repo, notifier)
			d.deps.Streaming.MsgRepo = &afterCommitReadFailureRepo{fakeMsgRepo: repo, failAt: failAt}
			d.deps.Streaming.StreamingBuffer = buf
			_, _ = d.Dispatch(context.Background(), DispatchInput{ConvID: "c1", UserID: "u1", Agent: &model.Agent{ID: "a1", Name: "Codex", CLITool: "codex", MachineID: stringPtr("m1")}}, DispatchHooks{})
			svc := NewMessageService(repo, &fakeConvRepoForMsg{conv: &model.Conversation{ID: "c1", UserID: "u1", Type: "agent"}}, nil)
			history, err := svc.GetHistory(context.Background(), "c1", "u1", nil, 20)
			if err != nil || len(history) != 1 {
				t.Fatalf("history: %v %+v", err, history)
			}
			assertFailureMessage(t, history[0], routingFailure)
			for _, event := range notifier.customCalls {
				if event.eventType != ws.TypeMessageComplete {
					continue
				}
				encoded, _ := json.Marshal(event.data)
				var terminal model.Message
				if err := json.Unmarshal(encoded, &terminal); err != nil {
					t.Fatal(err)
				}
				assertFailureMessage(t, terminal, routingFailure)
				if terminal.Content != "已输出的动画说明" || terminal.BlocksJSON != history[0].BlocksJSON || !strings.Contains(terminal.ArtifactsJSON, "Codex") {
					t.Fatalf("terminal reply incomplete: %+v", terminal)
				}
				return
			}
			t.Fatal("committed failure never reached live chat")
		})
	}
}

type failureEventNotifier struct {
	fakeStreamingNotifier
	done chan struct{}
}

func (n *failureEventNotifier) PushCustomEvent(convID string, members []string, kind string, data interface{}) {
	n.fakeStreamingNotifier.PushCustomEvent(convID, members, kind, data)
	if kind == ws.TypeMessageComplete {
		close(n.done)
	}
}

func TestSingleChatFailurePreservesPartialReplyAndRedactsCredentials(t *testing.T) {
	userID := "u1"
	// 同时覆盖单聊提交终态后重读故障，公开发送流程仍应原位广播失败。
	repo := &afterCommitReadFailureRepo{fakeMsgRepo: &fakeMsgRepo{}, failAt: 1}
	svc := NewMessageService(repo, &fakeConvRepoForMsg{conv: &model.Conversation{ID: "c1", UserID: userID, Type: "agent"}}, &fakeAgentRepoForMsg{
		agent: &model.Agent{ID: "a1", UserID: &userID, Name: "Claude", CLITool: "claude", MachineID: stringPtr("m1")}, inConversation: true,
	})
	buf := NewStreamingBuffer()
	svc.SetStreamingBuffer(buf)
	notifier := &failureEventNotifier{done: make(chan struct{})}
	svc.SetNotifier(notifier)
	ch := make(chan *ws.TaskResult, 1)
	hub := &fakeDaemonDispatcher{
		isConnected:         func(string) bool { return true },
		registerTaskPromise: func(string) chan *ws.TaskResult { return ch },
		sendToMachine: func(_ string, msg ws.WSMessage) error {
			id := msg.Data.(map[string]interface{})["task_id"].(string)
			buf.PushEvents(id, []model.AgentEvent{{Type: "text.delta", Content: "已经生成的正文"}})
			ch <- &ws.TaskResult{TaskID: id, Error: routingFailure + "\nAuthorization: Bearer bearer-secret\napi_key=key-secret password=pass-secret\nhttps://user:uri-secret@example.test/run?token=query-secret\n" + strings.Repeat("x", 4000)}
			return nil
		},
		awaitTaskResult: func(string) chan *ws.TaskResult { return ch }, removeTaskPromise: func(string) {},
	}
	svc.SetDaemonHub(hub)
	if _, err := svc.SendMessageWithReply(context.Background(), "c1", userID, "user", "hello", "", nil, nil, "a1", nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-notifier.done:
	case <-time.After(3 * time.Second):
		t.Fatal("no terminal event")
	}
	history, err := svc.GetHistory(context.Background(), "c1", userID, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	var reply model.Message
	for _, msg := range history {
		if msg.Role == "assistant" {
			reply = msg
		}
	}
	assertFailureMessage(t, reply, routingFailure)
	if reply.Content != "已经生成的正文" || !strings.Contains(reply.BlocksJSON, "已经生成的正文") {
		t.Fatalf("partial reply lost: %+v", reply)
	}
	for _, secret := range []string{"bearer-secret", "key-secret", "pass-secret", "uri-secret", "query-secret"} {
		if strings.Contains(reply.BlocksJSON, secret) {
			t.Fatalf("credential leaked: %s", secret)
		}
	}
	if len([]rune(reply.BlocksJSON)) > 2600 {
		t.Fatal("unbounded error display")
	}
}

func assertFailureMessage(t *testing.T, msg model.Message, reason string) {
	t.Helper()
	if msg.Status != model.MessageStatusError {
		t.Fatalf("still running: %+v", msg)
	}
	var blocks []model.MessageBlock
	if err := json.Unmarshal([]byte(msg.BlocksJSON), &blocks); err != nil {
		t.Fatalf("missing visible failure: %q (%v)", msg.BlocksJSON, err)
	}
	for _, block := range blocks {
		if block.Kind == model.BlockKindError && strings.Contains(block.Text, reason) {
			return
		}
	}
	t.Fatalf("failure reason missing: %+v", blocks)
}

func TestDispatcherTerminalFailureKeepsStoredReplyAndCancellation(t *testing.T) {
	for _, canceled := range []bool{false, true} {
		t.Run(map[bool]string{false: "failed", true: "canceled"}[canceled], func(t *testing.T) {
			repo := &fakeMsgRepo{}
			notifier := &fakeStreamingNotifier{}
			buf := NewStreamingBuffer()
			ch := make(chan *ws.TaskResult, 1)
			hub := &fakeDaemonDispatcher{
				isConnected:         func(string) bool { return true },
				registerTaskPromise: func(string) chan *ws.TaskResult { return ch },
				sendToMachine: func(_ string, msg ws.WSMessage) error {
					data := msg.Data.(map[string]interface{})
					id := data["task_id"].(string)
					if err := repo.FinalizeStreaming(context.Background(), data["message_id"].(string), model.MessageStatusStreaming, "已保存的正文", `[{"index":0,"kind":"text","text":"已保存的正文"}]`, ""); err != nil {
						t.Fatal(err)
					}
					if canceled {
						buf.PushEvents(id, []model.AgentEvent{{Type: "cancel"}})
					} else {
						buf.PushEvents(id, []model.AgentEvent{{Type: "text.delta", Content: "后续流式正文"}})
					}
					ch <- &ws.TaskResult{TaskID: id, Error: routingFailure}
					return nil
				},
				awaitTaskResult: func(string) chan *ws.TaskResult { return ch }, removeTaskPromise: func(string) {},
			}
			d := buildStreamingDispatcher(t, hub, repo, notifier)
			d.deps.Streaming.StreamingBuffer = buf
			_, _ = d.Dispatch(context.Background(), DispatchInput{ConvID: "c1", UserID: "u1", Agent: &model.Agent{ID: "a1", Name: "Codex", CLITool: "codex", MachineID: stringPtr("m1")}}, DispatchHooks{})
			svc := NewMessageService(repo, &fakeConvRepoForMsg{conv: &model.Conversation{ID: "c1", UserID: "u1", Type: "agent"}}, nil)
			history, err := svc.GetHistory(context.Background(), "c1", "u1", nil, 20)
			if err != nil || len(history) != 1 {
				t.Fatalf("history: %v %+v", err, history)
			}
			msg := history[0]
			if !strings.Contains(msg.Content, "已保存的正文") || !strings.Contains(msg.BlocksJSON, "已保存的正文") {
				t.Fatalf("stored reply lost: %+v", msg)
			}
			if canceled {
				if msg.Status != model.MessageStatusCanceled || strings.Contains(msg.BlocksJSON, `"kind":"error"`) {
					t.Fatalf("cancel turned into failure: %+v", msg)
				}
			} else {
				assertFailureMessage(t, msg, routingFailure)
				if !strings.Contains(msg.Content, "后续流式正文") || !strings.Contains(msg.BlocksJSON, "后续流式正文") {
					t.Fatal("later streamed reply lost")
				}
			}
		})
	}
}

type contextCheckingMessageRepo struct{ *fakeMsgRepo }

func (r *contextCheckingMessageRepo) FinalizeStreaming(ctx context.Context, id, status, content, blocks, artifacts string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return r.fakeMsgRepo.FinalizeStreaming(ctx, id, status, content, blocks, artifacts)
}

func TestDispatcherDeadlineStillPersistsTerminalReason(t *testing.T) {
	repo := &fakeMsgRepo{}
	notifier := &fakeStreamingNotifier{}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	ch := make(chan *ws.TaskResult)
	hub := &fakeDaemonDispatcher{
		isConnected:         func(string) bool { return true },
		registerTaskPromise: func(string) chan *ws.TaskResult { return ch },
		sendToMachine:       func(string, ws.WSMessage) error { <-ctx.Done(); return nil },
		awaitTaskResult:     func(string) chan *ws.TaskResult { return ch }, removeTaskPromise: func(string) {},
	}
	d := buildStreamingDispatcher(t, hub, repo, notifier)
	d.deps.Streaming.MsgRepo = &contextCheckingMessageRepo{repo}
	_, err := d.Dispatch(ctx, DispatchInput{ConvID: "c1", UserID: "u1", Agent: &model.Agent{ID: "a1", Name: "Codex", CLITool: "codex", MachineID: stringPtr("m1")}}, DispatchHooks{})
	if err == nil {
		t.Fatal("expected timeout")
	}
	svc := NewMessageService(repo, &fakeConvRepoForMsg{conv: &model.Conversation{ID: "c1", UserID: "u1", Type: "agent"}}, nil)
	history, err := svc.GetHistory(context.Background(), "c1", "u1", nil, 20)
	if err != nil || len(history) != 1 {
		t.Fatalf("history: %v %+v", err, history)
	}
	assertFailureMessage(t, history[0], ErrMsgAgentTimeout.Error())
	if notifier.CustomEventCountByType(ws.TypeMessageComplete) != 1 {
		t.Fatal("deadline left the UI streaming")
	}
}
