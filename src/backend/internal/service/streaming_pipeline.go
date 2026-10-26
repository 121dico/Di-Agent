// Package service: streaming_pipeline.go
//
// streaming_pipeline 抽出 createAgentReply（单聊路径）和 Dispatcher（群聊 worker 路径）
// 共享的流式 placeholder setup + finalize 逻辑，确保两条路径行为一致。
//
// 两条调用方：
//  1. MessageService.createAgentReply（单聊 /agent 路径，message.go）
//  2. Dispatcher.dispatchPlanCore（群聊 @mention worker 路径，dispatcher.go）
//
// 共享的状态：
//   - 预创建 streaming placeholder message（status=streaming）
//   - 注册 daemonHub task 映射（taskID→messageID / taskID→agentName）
//   - defer 清理（promise / taskMessages / taskAgents / streamingBuffer）
//   - FinalizeStreaming 落库（success: content/blocks_json/cards；error: 保留输出并追加安全错误）
//   - 失败时 broadcastStreamingTerminal 让前端切到终态
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

// StreamingHandle 持有流式 placeholder 的所有 bookkeeping 状态。
// setup 时创建，finalize 时被消费。调用方负责在 setup 后注册 defer 清理。
type StreamingHandle struct {
	TaskID         string
	MessageID      string
	AgentID        string
	AgentName      string
	ConvID         string
	ReplyTo        *string
	ArtifactsJSON  string // 预创建时写入（agent_id / agent_name / cli_tool）
	BlocksJSONZero string // 预创建时为空；error 终态广播时透传
	CreatedAt      time.Time
}

// StreamingPipelineDeps 是 setup / finalize 流式管线所需的最小依赖集合。
//
// 单聊路径（MessageService）与群聊 worker 路径（Dispatcher）共用同一组依赖，
// 通过本结构显式传入，避免在 Dispatcher 内反向依赖 MessageService。
type StreamingPipelineDeps struct {
	MsgRepo         StreamingMsgRepo
	DaemonHub       DaemonHubStreaming
	StreamingBuffer StreamingBufferStore
	Notifier        MessageNotifier
	ConvRepo        ConvRepoForDaemon
}

// StreamingMsgRepo 是流式管线需要的 msg 仓库子集。
// 完整 MsgRepo（message.go MsgRepo interface）自动满足此接口。
type StreamingMsgRepo interface {
	CreateStreaming(ctx context.Context, conversationID, role string, senderID *string, replyTo *string, artifactsJSON string) (*model.Message, error)
	FinalizeStreaming(ctx context.Context, messageID, status, content, blocksJSON, artifactsJSON string) error
	GetByID(ctx context.Context, id string) (*model.Message, error)
	UpdateMessageCards(ctx context.Context, messageID, cardsJSON string) error
	SaveArtifacts(ctx context.Context, messageID string, artifacts []model.Artifact) error
}

// DaemonHubStreaming 是流式管线需要的 daemonHub 子集。
// port.DaemonDispatcher + *ws.DaemonHub 自动满足（通过类型断言访问 task agent 方法）。
type DaemonHubStreaming interface {
	RegisterTaskPromise(taskID string) chan *ws.TaskResult
	RegisterTaskMessage(taskID, messageID string)
	DeleteTaskMessage(taskID string)
	RemoveTaskPromise(taskID string)
	// task→agentName 映射由 *ws.DaemonHub 提供（非 port 接口），
	// 通过 StreamingPipelineDeps 上额外的 RegisterTaskAgent / DeleteTaskAgent
	// 函数注入（避免强制 DaemonHub 类型）。
}

// TaskAgentIndex 抽象 daemonHub 上的 task→agentName 索引注册与清理。
// *ws.DaemonHub 满足此接口；测试可注入 fake。
type TaskAgentIndex interface {
	RegisterTaskAgent(taskID, agentName string)
	DeleteTaskAgent(taskID string)
}

// StreamingBufferStore 抽象 streamingBuffer 的最小 API。
// *StreamingBuffer 自动满足。
type StreamingBufferStore interface {
	Delete(taskID string)
}

// SetupStreamingPipeline 预创建 streaming placeholder message 并注册 task 映射。
//
// 顺序（与 createAgentReply 1215-1239 完全一致）：
//  1. Marshal artifactsJSON（agent_id / agent_name / cli_tool）
//  2. CreateStreaming placeholder
//  3. RegisterTaskPromise / RegisterTaskMessage / RegisterTaskAgent
//
// 调用方负责：
//   - 在调用本方法前先 CreateDaemonTask 拿到 taskID
//   - 在本方法返回后立即注册 defer 清理（RemoveTaskPromise / DeleteTaskMessage /
//     DeleteTaskAgent / StreamingBuffer.Delete）
//   - 在 dispatch 失败 / wait 失败 / task failed 时调 FinalizeStreamingPipeline(..., Error, ...)
//   - 在 dispatch 成功时调 FinalizeStreamingPipeline(..., Complete, ...)
//
// taskAgentIndex 可为 nil（调用方不需要 task→agentName 索引时，如单聊路径直接
// 类型断言 daemonHub）。
func SetupStreamingPipeline(
	ctx context.Context,
	deps StreamingPipelineDeps,
	convID, agentID, agentName, cliTool string,
	taskID string,
	replyTo *string,
	taskAgentIndex TaskAgentIndex,
) (*StreamingHandle, error) {
	if deps.MsgRepo == nil {
		return nil, fmt.Errorf("streaming pipeline: MsgRepo is nil")
	}
	artifacts, err := json.Marshal(map[string]string{
		"agent_id":   agentID,
		"agent_name": agentName,
		"cli_tool":   cliTool,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal streaming artifacts: %w", err)
	}
	streamingMsg, err := deps.MsgRepo.CreateStreaming(ctx, convID, "assistant", nil, replyTo, string(artifacts))
	if err != nil {
		return nil, fmt.Errorf("create streaming message: %w", err)
	}
	if deps.DaemonHub != nil {
		deps.DaemonHub.RegisterTaskPromise(taskID)
		deps.DaemonHub.RegisterTaskMessage(taskID, streamingMsg.ID)
	}
	if taskAgentIndex != nil {
		taskAgentIndex.RegisterTaskAgent(taskID, agentName)
	}
	handle := &StreamingHandle{
		TaskID:        taskID,
		MessageID:     streamingMsg.ID,
		AgentID:       agentID,
		AgentName:     agentName,
		ConvID:        convID,
		ReplyTo:       replyTo,
		ArtifactsJSON: string(artifacts),
		CreatedAt:     streamingMsg.CreatedAt,
	}
	// 模型可能很久才产生第一个 token。先把已经持久化的占位消息推给群聊，
	// 让工人立即出现；后续真实 delta 继续更新同一个 message_id。
	broadcastStreamingStarted(ctx, deps, handle, cliTool)
	return handle, nil
}

func broadcastStreamingStarted(ctx context.Context, deps StreamingPipelineDeps, handle *StreamingHandle, cliTool string) {
	if deps.Notifier == nil || deps.ConvRepo == nil {
		return
	}
	listCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	memberIDs, err := deps.ConvRepo.ListMemberIDs(listCtx, handle.ConvID)
	if err != nil {
		slog.Warn("streaming pipeline: list members for start failed", "conversation_id", handle.ConvID, "error", err)
		return
	}
	if len(memberIDs) == 0 {
		return
	}
	deps.Notifier.PushCustomEvent(handle.ConvID, memberIDs, ws.TypeMessageStreaming, map[string]interface{}{
		"message_id":      handle.MessageID,
		"conversation_id": handle.ConvID,
		"task_id":         handle.TaskID,
		"agent_id":        handle.AgentID,
		"agent_name":      handle.AgentName,
		"cli_tool":        cliTool,
		"reply_to":        handle.ReplyTo,
		"created_at":      handle.CreatedAt,
		"deltas":          []model.AgentEvent{},
	})
}

// FinalizeStreamingPipelineOptions 控制 FinalizeStreamingPipeline 的行为。
// 失败/取消路径先恢复已输出内容，再保存终态。
type FinalizeStreamingPipelineOptions struct {
	Status          string // model.MessageStatusComplete / model.MessageStatusError
	Content         string // 最终正文，失败时也可传入已输出的部分正文。
	ErrorReason     string // 仅在持久化边界统一脱敏、限长。
	BlocksJSON      string // 失败路径传空串；成功路径来自 streamingBuffer.GetState
	ArtifactsJSON   string // 失败路径传空串；成功路径重写 artifacts
	Cards           []map[string]any
	Artifacts       []model.Artifact // 持久化到独立 artifacts 表（成功路径）
	previousMessage *model.Message   // 保存失败前的关联信息，供提交后重读失败时回退。
}

// FinalizeStreamingPipeline 完成 streaming placeholder 的最终化：
//  1. FinalizeStreaming UPDATE message 字段（status / content / blocks_json / artifacts_json）
//  2. 重查 GetByID 拿完整关联（reply_to_message / attachments / cards）
//  3. 若 opts.Cards 非空：UpdateMessageCards 落卡 + 回填 msg.Cards
//  4. 若 opts.Artifacts 非空：SaveArtifacts 落独立 artifacts 表 + 回填 msg.Artifacts
//
// 失败路径（Status=Error）调用方仍应额外调 BroadcastStreamingTerminal 让前端
// 切到终态（本函数只做 DB UPDATE，不广播）。
//
// 返回重新加载的消息；提交后重读失败或查无记录时使用已保存字段和原关联回退。
func FinalizeStreamingPipeline(
	ctx context.Context,
	deps StreamingPipelineDeps,
	handle *StreamingHandle,
	opts FinalizeStreamingPipelineOptions,
) (*model.Message, error) {
	if deps.MsgRepo == nil || handle == nil {
		return nil, fmt.Errorf("streaming pipeline: nil deps or handle")
	}
	if opts.Status == model.MessageStatusError || opts.Status == model.MessageStatusCanceled {
		// 超时已取消原 context，保存终态必须使用独立且有限时的 context。
		terminalCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		ctx = terminalCtx
		if err := prepareStreamingFailure(ctx, deps, handle, &opts); err != nil {
			return nil, err
		}
	}
	if err := deps.MsgRepo.FinalizeStreaming(ctx, handle.MessageID, opts.Status, opts.Content, opts.BlocksJSON, opts.ArtifactsJSON); err != nil {
		return nil, fmt.Errorf("finalize streaming message: %w", err)
	}
	fullMsg, err := deps.MsgRepo.GetByID(ctx, handle.MessageID)
	if err != nil {
		// UPDATE 已成功，不得因为补全关联信息失败而丢掉已保存的终态。
		slog.Warn("streaming pipeline: reload finalized message failed", "message_id", handle.MessageID, "error", err)
	}
	var msg *model.Message
	if fullMsg != nil {
		msg = fullMsg
	} else {
		// 使用刚成功保存的字段；保留已有回复关联，不依赖第二次数据库读取。
		msg = &model.Message{
			ID:             handle.MessageID,
			ConversationID: handle.ConvID,
			Role:           "assistant",
			Content:        opts.Content,
			BlocksJSON:     opts.BlocksJSON,
			ArtifactsJSON:  opts.ArtifactsJSON,
			Status:         opts.Status,
			CreatedAt:      handle.CreatedAt,
			ReplyTo:        handle.ReplyTo,
		}
		if opts.previousMessage != nil {
			previous := *opts.previousMessage
			msg = &previous
		}
		msg.Status = opts.Status
		msg.Content = opts.Content
		msg.BlocksJSON = opts.BlocksJSON
		if opts.ArtifactsJSON != "" {
			msg.ArtifactsJSON = opts.ArtifactsJSON
		}
		if msg.ArtifactsJSON == "" {
			msg.ArtifactsJSON = handle.ArtifactsJSON
		}
	}

	if len(opts.Cards) > 0 {
		cardsJSON, _ := json.Marshal(opts.Cards)
		if err := deps.MsgRepo.UpdateMessageCards(ctx, msg.ID, string(cardsJSON)); err != nil {
			slog.Warn("streaming pipeline: update message cards failed", "message_id", msg.ID, "error", err)
		} else {
			msg.CardsJSON = string(cardsJSON)
			msg.Cards = opts.Cards
		}
	}

	if len(opts.Artifacts) > 0 {
		if err := deps.MsgRepo.SaveArtifacts(ctx, msg.ID, opts.Artifacts); err != nil {
			slog.Warn("streaming pipeline: save artifacts failed", "message_id", msg.ID, "error", err)
		} else {
			msg.Artifacts = opts.Artifacts
		}
	}

	return msg, nil
}

// BroadcastStreamingTerminal 广播 streaming message 的终态（error/canceled）给
// 会话成员，让前端把 streaming 占位符切到终态 status、清理 streamingTaskIds、
// 卸载 StopButton / streaming cursor。
//
// 与原 MessageService.broadcastStreamingTerminal（已删除）行为一致——抽出为顶层函数后供
// Dispatcher 在失败路径调用（Dispatcher 不持有 *MessageService）。
//
// best-effort：notifier / convRepo 任一为 nil 直接 no-op；ListMemberIDs 失败
// 也只 log warn 不传播错误。
func BroadcastStreamingTerminal(deps StreamingPipelineDeps, handle *StreamingHandle, status string, saved ...*model.Message) {
	if deps.Notifier == nil || deps.ConvRepo == nil || handle == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	memberIDs, err := deps.ConvRepo.ListMemberIDs(ctx, handle.ConvID)
	if err != nil {
		slog.Warn("BroadcastStreamingTerminal: list members failed",
			"message_id", handle.MessageID, "error", err)
		return
	}
	if len(memberIDs) == 0 {
		return
	}
	// 调用方已经拿到提交后的快照，不再重复读取数据库。
	if len(saved) > 0 && saved[0] != nil {
		deps.Notifier.PushCustomEvent(handle.ConvID, memberIDs, ws.TypeMessageComplete, saved[0])
		return
	}
	payload := map[string]interface{}{
		"id":              handle.MessageID,
		"conversation_id": handle.ConvID,
		"role":            "assistant",
		"status":          status,
		"content":         "",
		"blocks_json":     "",
		"artifacts_json":  handle.ArtifactsJSON,
		"cards_json":      "[]",
		"created_at":      handle.CreatedAt,
		"sender_id":       nil,
	}
	if deps.MsgRepo != nil {
		msg, err := deps.MsgRepo.GetByID(ctx, handle.MessageID)
		if err != nil {
			slog.Warn("BroadcastStreamingTerminal: reload failed", "message_id", handle.MessageID, "error", err)
		}
		if msg != nil {
			deps.Notifier.PushCustomEvent(handle.ConvID, memberIDs, ws.TypeMessageComplete, msg)
			return
		}
	}
	deps.Notifier.PushCustomEvent(handle.ConvID, memberIDs, ws.TypeMessageComplete, payload)
}
