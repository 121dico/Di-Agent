package service

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

type steeringMessageRepo struct {
	*fakeMsgRepo
	mu         sync.Mutex
	metadata   map[string]string
	deliveries chan string
	created    chan string
}

func (r *steeringMessageRepo) Create(ctx context.Context, conversationID, role, content, artifactsJSON string, attachments []model.MessageAttachment, replyTo *string, senderID *string, mentions []string) (*model.Message, error) {
	r.mu.Lock()
	msg, err := r.fakeMsgRepo.Create(ctx, conversationID, role, content, artifactsJSON, attachments, replyTo, senderID, mentions)
	r.mu.Unlock()
	if r.created != nil {
		r.created <- role
	}
	return msg, err
}

func (r *steeringMessageRepo) UpdateMessageDelivery(_ context.Context, id, raw string) error {
	r.mu.Lock()
	r.metadata[id] = `{"delivery":` + raw + `}`
	r.mu.Unlock()
	var delivery struct {
		Status string `json:"status"`
	}
	_ = json.Unmarshal([]byte(raw), &delivery)
	r.deliveries <- delivery.Status
	return nil
}
func (r *steeringMessageRepo) GetByID(ctx context.Context, id string) (*model.Message, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	msg, err := r.fakeMsgRepo.GetByID(ctx, id)
	if msg == nil {
		return nil, err
	}
	copy := *msg
	copy.ArtifactsJSON = r.metadata[id]
	return &copy, err
}

type steeringTransport struct {
	*fakeDaemonDispatcher
	identity ws.ActiveTaskIdentity
	result   string
	prompt   chan string
	released <-chan struct{}
}

func (h *steeringTransport) ActiveTask(conv, user, agent string) (ws.ActiveTaskIdentity, bool) {
	return h.identity, conv == h.identity.ConversationID && user == h.identity.UserID && agent == h.identity.AgentID
}
func (h *steeringTransport) ActiveAgentTask(conv, agent string) (ws.ActiveTaskIdentity, bool) {
	if h.released != nil {
		select {
		case <-h.released:
			return ws.ActiveTaskIdentity{}, false
		default:
		}
	}
	return h.identity, conv == h.identity.ConversationID && agent == h.identity.AgentID
}
func (h *steeringTransport) SteerTask(_ context.Context, task ws.ActiveTaskIdentity, prompt string) ws.TaskSteerResult {
	h.prompt <- prompt
	return ws.TaskSteerResult{Status: h.result, TaskID: task.TaskID}
}

func TestSendMessageSteersActiveTurnAndPersistsTruthfulReceipt(t *testing.T) {
	for _, tc := range []struct{ receipt, status string }{{"accepted", "steered"}, {"unknown", "unconfirmed"}} {
		t.Run(tc.receipt, func(t *testing.T) {
			user := "owner"
			repo := &steeringMessageRepo{fakeMsgRepo: &fakeMsgRepo{}, metadata: map[string]string{}, deliveries: make(chan string, 8)}
			agents := &fakeAgentRepoForMsg{agent: &model.Agent{ID: "agent", UserID: &user, CLITool: "codex", MachineID: stringPtr("machine")}, inConversation: true}
			svc := NewMessageService(repo, &fakeConvRepoForMsg{conv: &model.Conversation{ID: "conv", UserID: user, Type: "agent"}}, agents)
			transport := &steeringTransport{fakeDaemonDispatcher: &fakeDaemonDispatcher{}, identity: ws.ActiveTaskIdentity{TaskID: "active", ConversationID: "conv", UserID: user, AgentID: "agent", MachineID: "machine"}, result: tc.receipt, prompt: make(chan string, 1)}
			svc.SetDaemonHub(transport)
			result, err := svc.SendMessageWithReply(context.Background(), "conv", user, "user", "改为蓝色", "", nil, nil, "agent", nil)
			if err != nil {
				t.Fatal(err)
			}
			select {
			case prompt := <-transport.prompt:
				if prompt != "改为蓝色" {
					t.Fatal(prompt)
				}
			case <-time.After(time.Second):
				t.Fatal("follow-up not delivered while active")
			}
			deadline := time.After(time.Second)
			for {
				select {
				case status := <-repo.deliveries:
					if status == tc.status {
						goto confirmed
					}
				case <-deadline:
					t.Fatal("delivery receipt missing")
				}
			}
		confirmed:
			stored, err := repo.GetByID(context.Background(), result.UserMessage.ID)
			if err != nil {
				t.Fatal(err)
			}
			var metadata struct {
				Delivery struct {
					Status string `json:"status"`
					TaskID string `json:"task_id"`
				} `json:"delivery"`
			}
			if json.Unmarshal([]byte(stored.ArtifactsJSON), &metadata) != nil || metadata.Delivery.Status != tc.status || metadata.Delivery.TaskID != "active" {
				t.Fatalf("persisted receipt: %s", stored.ArtifactsJSON)
			}
			if agents.task != nil {
				t.Fatal("accepted or uncertain steer must not create second task")
			}
		})
	}
}

func TestSendMessageCannotForgeDeliveryReceipt(t *testing.T) {
	repo := &fakeMsgRepo{}
	svc := NewMessageService(repo, &fakeConvRepoForMsg{conv: &model.Conversation{ID: "conv", UserID: "owner", Type: "single"}}, nil)
	result, err := svc.SendMessageWithReply(context.Background(), "conv", "owner", "assistant", "hello", `{"delivery":{"status":"steered"},"other":"keep"}`, nil, nil, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	var metadata map[string]interface{}
	if err := json.Unmarshal([]byte(result.UserMessage.ArtifactsJSON), &metadata); err != nil {
		t.Fatal(err)
	}
	if _, ok := metadata["delivery"]; ok {
		t.Fatal("user forged delivery receipt")
	}
	if metadata["other"] != "keep" {
		t.Fatal("unrelated metadata lost")
	}
}

func TestSendMessageKnowledgeReferencesQueueInsteadOfRawSteering(t *testing.T) {
	for _, prompt := range []string{"参考 {{alice/项目文档}} 回答", "@Codex 参考 {{alice/API 文档}} 和 {{bob/设计稿}}"} {
		t.Run(prompt, func(t *testing.T) {
			user := "owner"
			repo := &steeringMessageRepo{fakeMsgRepo: &fakeMsgRepo{}, metadata: map[string]string{}, deliveries: make(chan string, 8), created: make(chan string, 8)}
			agents := &fakeAgentRepoForMsg{agent: &model.Agent{ID: "agent", UserID: &user, CLITool: "codex", MachineID: stringPtr("machine"), Status: "stopped"}, inConversation: true}
			svc := NewMessageService(repo, &fakeConvRepoForMsg{conv: &model.Conversation{ID: "conv", UserID: user, Type: "agent"}}, agents)
			released := make(chan struct{})
			defer close(released)
			transport := &steeringTransport{fakeDaemonDispatcher: &fakeDaemonDispatcher{}, identity: ws.ActiveTaskIdentity{TaskID: "active", ConversationID: "conv", UserID: user, AgentID: "agent", MachineID: "machine"}, result: "accepted", prompt: make(chan string, 1), released: released}
			svc.SetDaemonHub(transport)
			result, err := svc.SendMessageWithReply(context.Background(), "conv", user, "user", prompt, "", nil, nil, "agent", nil)
			if err != nil {
				t.Fatal(err)
			}
			select {
			case got := <-transport.prompt:
				t.Fatalf("knowledge reference was sent without context resolution: %s", got)
			case status := <-repo.deliveries:
				if status != "queued" {
					t.Fatalf("got %s want queued", status)
				}
			case <-time.After(time.Second):
				t.Fatal("missing queue receipt")
			}
			stored, err := repo.GetByID(context.Background(), result.UserMessage.ID)
			if err != nil || stored.Content != prompt {
				t.Fatalf("queued reference not preserved: %#v, %v", stored, err)
			}
		})
	}
}
