package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"sort"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

type messageSteerer interface {
	ActiveTask(string, string, string) (ws.ActiveTaskIdentity, bool)
	ActiveAgentTask(string, string) (ws.ActiveTaskIdentity, bool)
	SteerTask(context.Context, ws.ActiveTaskIdentity, string) ws.TaskSteerResult
}

type messageDeliveryWriter interface {
	UpdateMessageDelivery(context.Context, string, string) error
}

func (s *MessageService) mentionTargets(ctx context.Context, convID, userID, content string) []string {
	agents, err := s.convRepo.ListAgents(ctx, convID, userID)
	if err != nil {
		return nil
	}
	matched := FindMentionedAgentID(ParseMentions(content), agents)
	unique := map[string]bool{}
	for _, id := range matched {
		unique[id] = true
	}
	var ids []string
	for id := range unique {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// queueAgentMessage 持久化与回复执行解耦，HTTP 返回不等待 Agent。
func (s *MessageService) queueAgentMessage(msg *model.Message, userID, agentID string, run func()) {
	s.queueAgentMessages(msg, userID, []string{agentID}, run)
}

func (s *MessageService) queueAgentMessages(msg *model.Message, userID string, agentIDs []string, run func()) {
	agentID := agentIDs[0]
	messageID, convID, prompt := msg.ID, msg.ConversationID, msg.Content
	// 知识库引用必须经正常上下文链解析，不能把未展开的占位符当作原始引导发送。
	textOnly := len(msg.Attachments) == 0 && len(agentIDs) == 1 && len(ParseKnowledgeRefs(prompt)) == 0
	var lastStamp int64
	setDelivery := func(status, taskID string) {
		now := time.Now().UnixMilli()
		if now <= lastStamp {
			now = lastStamp + 1
		}
		lastStamp = now
		delivery := map[string]interface{}{"status": status, "agent_id": agentID, "updated_at": now}
		if taskID != "" {
			delivery["task_id"] = taskID
		}
		s.saveMessageDelivery(convID, userID, messageID, delivery)
	}
	steerer, _ := s.daemonHub.(messageSteerer)
	trySteer := func() bool {
		if steerer == nil || s.agentRepo == nil || !textOnly {
			return false
		}
		task, ok := steerer.ActiveTask(convID, userID, agentID)
		if !ok {
			return false
		}
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		// 对话成员、Agent 可见性及任务所有者三重绑定，不能引导其他人的任务。
		agent, err := s.agentRepo.GetByID(ctx, agentID)
		if err != nil || agent == nil || agent.MachineID == nil || *agent.MachineID != task.MachineID || agent.CLITool != "codex" {
			return false
		}
		if agent.UserID != nil && *agent.UserID != userID {
			return false
		}
		allowed, err := s.agentRepo.IsAgentInConversation(ctx, convID, agentID, userID)
		if err != nil || !allowed {
			return false
		}
		setDelivery("sending", task.TaskID)
		result := steerer.SteerTask(ctx, task, prompt)
		switch result.Status {
		case "accepted":
			setDelivery("steered", task.TaskID)
			return true
		case "unavailable":
			return false
		default:
			setDelivery("unconfirmed", task.TaskID)
			return true
		}
	}
	execute := func(ready func()) {
		ctx, cancel := agentTaskContext(context.Background())
		defer cancel()
		// 外部编排产生的任务不在本队列中，等它真正结束后才新开一轮。
		if steerer != nil {
			for _, targetID := range agentIDs {
				for {
					if _, busy := steerer.ActiveAgentTask(convID, targetID); !busy {
						break
					}
					select {
					case <-ctx.Done():
						setDelivery("unconfirmed", "")
						return
					case <-time.After(200 * time.Millisecond):
					}
				}
			}
		}
		setDelivery("running", "")
		ready()
		run()
	}
	queued := func() { setDelivery("queued", "") }
	if len(agentIDs) == 1 {
		s.dispatchQueue.SubmitWhenReady(convID+"/"+agentID, trySteer, execute, queued)
	} else {
		keys := make([]string, len(agentIDs))
		for i, id := range agentIDs {
			keys[i] = convID + "/" + id
		}
		s.dispatchQueue.SubmitManyWhenReady(keys, execute, queued)
	}
}

func (s *MessageService) saveMessageDelivery(convID, userID, messageID string, delivery map[string]interface{}) {
	writer, ok := s.msgRepo.(messageDeliveryWriter)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	raw, err := json.Marshal(delivery)
	if err != nil {
		return
	}
	if err = writer.UpdateMessageDelivery(ctx, messageID, string(raw)); err != nil {
		slog.Warn("message delivery persistence failed", "message_id", messageID, "error", err)
		return
	}
	if s.notifier == nil {
		return
	}
	members, err := s.convRepo.ListMemberIDs(ctx, convID)
	if err != nil || len(members) == 0 {
		members = []string{userID}
	}
	s.notifier.PushCustomEvent(convID, members, "message.delivery", map[string]interface{}{"conversation_id": convID, "message_id": messageID, "delivery": delivery})
}
