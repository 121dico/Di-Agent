package ws

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"nhooyr.io/websocket"
)

const daemonSendBuf = 64
const daemonTaskDisconnectGrace = time.Minute

// TaskResult daemon 任务执行结果
type TaskResult struct {
	TaskID       string           `json:"task_id"`
	Result       string           `json:"result"`
	Error        string           `json:"error"`
	CLISessionID string           `json:"session_id,omitempty"`
	Artifacts    []ArtifactResult `json:"artifacts,omitempty"`
	Cards        []map[string]any `json:"cards,omitempty"` // render_card 工具渲染的交互式卡片
}

// ArtifactResult daemon 解析出的结构化产物（随 task.complete 上行）。
// 字段名必须与 backend model.Artifact 的 json tag 及前端 TS 类型对齐。
type ArtifactResult struct {
	Type     string `json:"type"` // code | webpage
	Language string `json:"language,omitempty"`
	Filename string `json:"filename,omitempty"`
	Title    string `json:"title,omitempty"`
	URL      string `json:"url,omitempty"`
	Content  string `json:"content,omitempty"`
}

// DaemonClient 封装单个 daemon WebSocket 连接
type DaemonClient struct {
	Conn         *websocket.Conn
	MachineID    string // DaemonMachine.ID（DB 主键，非 hostname）
	sendCh       chan []byte
	done         chan struct{}
	closeOnce    sync.Once
	closed       atomic.Bool
	mu           sync.Mutex
	capabilities map[string]struct{}
}

// SetCapabilities replaces the protocol features explicitly advertised by this
// exact live daemon connection. Missing capabilities are never inferred from a
// client or CLI version.
func (dc *DaemonClient) SetCapabilities(capabilities []string) {
	dc.mu.Lock()
	defer dc.mu.Unlock()
	dc.capabilities = make(map[string]struct{}, len(capabilities))
	for _, capability := range capabilities {
		if capability != "" {
			dc.capabilities[capability] = struct{}{}
		}
	}
}

func (dc *DaemonClient) supportsCapability(capability string) bool {
	dc.mu.Lock()
	defer dc.mu.Unlock()
	_, ok := dc.capabilities[capability]
	return ok
}

// NewDaemonClient 创建 DaemonClient 实例
func NewDaemonClient(conn *websocket.Conn, machineID string) *DaemonClient {
	return &DaemonClient{
		Conn:      conn,
		MachineID: machineID,
		sendCh:    make(chan []byte, daemonSendBuf),
		done:      make(chan struct{}),
	}
}

func (dc *DaemonClient) close(status websocket.StatusCode, reason string) {
	dc.closed.Store(true)
	dc.closeOnce.Do(func() {
		close(dc.done)
		if dc.Conn != nil {
			_ = dc.Conn.Close(status, reason)
		}
	})
}

// closeNow 用于被替换/撤销的连接，避免关闭握手阻塞 Hub 消息总线。
func (dc *DaemonClient) closeNow() {
	dc.closed.Store(true)
	dc.closeOnce.Do(func() {
		close(dc.done)
		if dc.Conn != nil {
			_ = dc.Conn.CloseNow()
		}
	})
}

// WritePump 从 sendCh 读取消息写入连接
func (dc *DaemonClient) WritePump(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-dc.done:
			return
		case data, ok := <-dc.sendCh:
			if !ok {
				return
			}
			dc.mu.Lock()
			err := dc.Conn.Write(ctx, websocket.MessageText, data)
			dc.mu.Unlock()
			if err != nil {
				return
			}
		}
	}
}

// Send 向 daemon 发送 JSON 消息（通过写缓冲区）
func (dc *DaemonClient) Send(msg WSMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	dc.mu.Lock()
	defer dc.mu.Unlock()
	if dc.closed.Load() {
		return errors.New("daemon client closed: " + dc.MachineID)
	}
	select {
	case dc.sendCh <- data:
		return nil
	default:
		return errors.New("daemon write buffer full: " + dc.MachineID)
	}
}

func (dc *DaemonClient) sendRequiringCapability(capability string, msg WSMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	dc.mu.Lock()
	defer dc.mu.Unlock()
	if dc.closed.Load() {
		return errors.New("daemon client closed: " + dc.MachineID)
	}
	if _, ok := dc.capabilities[capability]; !ok {
		return errors.New("daemon capability unavailable: " + capability)
	}
	select {
	case dc.sendCh <- data:
		return nil
	default:
		return errors.New("daemon write buffer full: " + dc.MachineID)
	}
}

// --- DaemonHub 内部总线类型 ---

type daemonBusKind int

const (
	daemonBusRegister daemonBusKind = iota
	daemonBusUnregister
)

type daemonBusMsg struct {
	kind    daemonBusKind
	payload interface{}
}

// DaemonHub 管理所有 daemon WebSocket 连接，基于消息总线模式。
// 与用户 Hub 相同设计：单 goroutine 事件循环 + sync.Map + buffered bus channel。
type DaemonHub struct {
	steerPending       sync.Map // requestID -> 同一连接的引导回执
	managedMCPPending  sync.Map // requestID -> 同一条连接的本机配置响应
	managedMCPMachines sync.Map // 每台电脑最多一个进行中的配置操作
	lifecycleMu        sync.Mutex
	revokedMachines    sync.Map // 本进程内阻止已经排队的旧连接重新注册
	taskMachines       sync.Map // taskID -> machineID; fail pending work after a sustained disconnect
	taskCancelData     sync.Map // taskID -> 最小取消上下文，不保留 prompt
	clients            sync.Map // machineID -> *DaemonClient
	resultChans        sync.Map // taskID -> chan *TaskResult
	taskMessages       sync.Map // taskID -> messageID（daemon 丢字段时的兜底映射）
	taskAgents         sync.Map // taskID -> agentName（PR3：message.streaming 广播时携带 agent_name）
	agentApprovals     sync.Map // approvalID -> AgentApprovalContext
	approvalMu         sync.Mutex
	approvalRevisions  map[string]uint64 // authenticated user/conversation -> monotonic state revision
	bus                chan daemonBusMsg
	logger             *slog.Logger
	wg                 sync.WaitGroup
	draining           atomic.Bool
	shutdownOnce       sync.Once
}

// AgentApprovalContext binds a daemon approval request to the authenticated task owner.
type AgentApprovalContext struct {
	ApprovalID     string
	MachineID      string
	TaskID         string
	ConversationID string
	UserID         string
	AgentID        string
	Kind           string
	Method         string
	DetailsJSON    string
	ExpiresAt      time.Time
}

// AgentApprovalPayload is the replay-safe browser representation of a pending
// approval. Daemon and user ownership fields remain server-side.
type AgentApprovalPayload struct {
	ApprovalID     string          `json:"approval_id"`
	TaskID         string          `json:"task_id"`
	ConversationID string          `json:"conversation_id"`
	AgentID        string          `json:"agent_id"`
	Kind           string          `json:"kind"`
	Method         string          `json:"method"`
	Details        json.RawMessage `json:"details"`
	ExpiresAt      time.Time       `json:"expires_at"`
}

// NewDaemonHub 创建 DaemonHub 实例
func NewDaemonHub(logger *slog.Logger) *DaemonHub {
	return &DaemonHub{
		bus:               make(chan daemonBusMsg, 256),
		logger:            logger,
		approvalRevisions: make(map[string]uint64),
	}
}

// RegisterTaskMessage 存储 task_id → message_id 映射，供 handleTaskProgress 补齐。
func (dh *DaemonHub) RegisterTaskMessage(taskID, messageID string) {
	if taskID != "" && messageID != "" {
		dh.taskMessages.Store(taskID, messageID)
	}
}

// GetTaskMessage 查询 task_id 对应的 message_id，不存在返回空。
func (dh *DaemonHub) GetTaskMessage(taskID string) string {
	v, ok := dh.taskMessages.Load(taskID)
	if ok {
		return v.(string)
	}
	return ""
}

// RegisterTaskAgent 存储 task_id → agent_name 映射，供 handleTaskProgress 在
// 广播 message.streaming 时携带 agent_name（前端 placeholder 用作 username）。
// PR3 引入——消除"流式期间 username 为空 → fallback 助手"的视觉 bug。
func (dh *DaemonHub) RegisterTaskAgent(taskID, agentName string) {
	if taskID != "" && agentName != "" {
		dh.taskAgents.Store(taskID, agentName)
	}
}

// GetTaskAgent 查询 task_id 对应的 agent_name，不存在返回空。
func (dh *DaemonHub) GetTaskAgent(taskID string) string {
	v, ok := dh.taskAgents.Load(taskID)
	if ok {
		return v.(string)
	}
	return ""
}

// DeleteTaskAgent 清理 task_id → agent_name 映射（FinalizeStreaming 后调用）。
// 防止 sync.Map 无限增长——与 DeleteTaskMessage 同构，PR5 引入清理时机。
func (dh *DaemonHub) DeleteTaskAgent(taskID string) {
	dh.taskAgents.Delete(taskID)
}

// DeleteTaskMessage 清理 task_id → message_id 映射（FinalizeStreaming 后调用）。
// PR5：修复历史内存泄漏——RegisterTaskMessage 只 Store 不 Delete，长跑后端会
// 累积所有 taskID。与 DeleteTaskAgent 同构，createAgentReply 在所有终态路径
// 统一调 defer daemonHub.DeleteTaskMessage(task.ID) 清理。
func (dh *DaemonHub) DeleteTaskMessage(taskID string) {
	if taskID == "" {
		return
	}
	dh.taskMessages.Delete(taskID)
}

func approvalRevisionKey(userID, conversationID string) string {
	return userID + "\x00" + conversationID
}

func (dh *DaemonHub) bumpApprovalRevisionLocked(userID, conversationID string) uint64 {
	key := approvalRevisionKey(userID, conversationID)
	dh.approvalRevisions[key]++
	return dh.approvalRevisions[key]
}

// RegisterAgentApproval records the immutable ownership boundary for a pending request.
func (dh *DaemonHub) RegisterAgentApproval(value AgentApprovalContext) {
	if value.ApprovalID == "" || value.MachineID == "" || value.UserID == "" {
		return
	}
	if value.ExpiresAt.IsZero() {
		value.ExpiresAt = time.Now().Add(5 * time.Minute)
	}
	dh.approvalMu.Lock()
	dh.agentApprovals.Store(value.ApprovalID, value)
	dh.bumpApprovalRevisionLocked(value.UserID, value.ConversationID)
	dh.approvalMu.Unlock()
	ttl := time.Until(value.ExpiresAt)
	if ttl <= 0 {
		dh.approvalMu.Lock()
		if dh.agentApprovals.CompareAndDelete(value.ApprovalID, value) {
			dh.bumpApprovalRevisionLocked(value.UserID, value.ConversationID)
		}
		dh.approvalMu.Unlock()
		return
	}
	time.AfterFunc(ttl, func() {
		// Compare protects a newer request in the improbable event of ID reuse.
		dh.approvalMu.Lock()
		if dh.agentApprovals.CompareAndDelete(value.ApprovalID, value) {
			dh.bumpApprovalRevisionLocked(value.UserID, value.ConversationID)
		}
		dh.approvalMu.Unlock()
	})
}

// PendingAgentApprovals returns still-valid requests for one authenticated
// conversation. It supports browser reconnect, refresh, and conversation switch.
func (dh *DaemonHub) PendingAgentApprovals(userID, conversationID string) []AgentApprovalPayload {
	result, _ := dh.PendingAgentApprovalsWithRevision(userID, conversationID)
	return result
}

// PendingAgentApprovalsWithRevision returns an atomic state snapshot. The
// revision lets browsers discard snapshots/events that arrive out of order.
func (dh *DaemonHub) PendingAgentApprovalsWithRevision(userID, conversationID string) ([]AgentApprovalPayload, uint64) {
	dh.approvalMu.Lock()
	defer dh.approvalMu.Unlock()
	now := time.Now()
	result := make([]AgentApprovalPayload, 0)
	dh.agentApprovals.Range(func(key, raw any) bool {
		approval := raw.(AgentApprovalContext)
		if now.After(approval.ExpiresAt) {
			if dh.agentApprovals.CompareAndDelete(key, approval) {
				dh.bumpApprovalRevisionLocked(approval.UserID, approval.ConversationID)
			}
			return true
		}
		if approval.UserID != userID || approval.ConversationID != conversationID {
			return true
		}
		details := json.RawMessage(`{}`)
		if json.Valid([]byte(approval.DetailsJSON)) {
			details = json.RawMessage(approval.DetailsJSON)
		}
		result = append(result, AgentApprovalPayload{
			ApprovalID: approval.ApprovalID, TaskID: approval.TaskID,
			ConversationID: approval.ConversationID, AgentID: approval.AgentID,
			Kind: approval.Kind, Method: approval.Method, Details: details,
			ExpiresAt: approval.ExpiresAt,
		})
		return true
	})
	return result, dh.approvalRevisions[approvalRevisionKey(userID, conversationID)]
}

// ResolveAgentApproval validates the deciding user/conversation and forwards an
// allowlisted decision. The request remains pending until the daemon confirms
// that the decision reached the original app-server RPC.
func (dh *DaemonHub) ResolveAgentApproval(approvalID, userID, conversationID, decision string) error {
	dh.approvalMu.Lock()
	value, ok := dh.agentApprovals.Load(approvalID)
	if !ok {
		dh.approvalMu.Unlock()
		return errors.New("approval request not found")
	}
	approval := value.(AgentApprovalContext)
	if approval.UserID != userID || approval.ConversationID != conversationID {
		dh.approvalMu.Unlock()
		return errors.New("approval request owner mismatch")
	}
	if time.Now().After(approval.ExpiresAt) {
		dh.agentApprovals.Delete(approvalID)
		dh.bumpApprovalRevisionLocked(approval.UserID, approval.ConversationID)
		dh.approvalMu.Unlock()
		return errors.New("approval request expired")
	}
	if decision != "accept" && decision != "acceptForSession" && decision != "decline" {
		dh.approvalMu.Unlock()
		return errors.New("invalid approval decision")
	}
	dh.approvalMu.Unlock()
	return dh.SendToMachine(approval.MachineID, WSMessage{
		Type: "task.approval_decision",
		Data: map[string]interface{}{
			"approval_id": approvalID,
			"task_id":     approval.TaskID,
			"decision":    decision,
		},
	})
}

// AcknowledgeAgentApproval consumes a request only after its daemon confirms
// that the decision was written back to the waiting app-server request.
func (dh *DaemonHub) AcknowledgeAgentApproval(approvalID, machineID, taskID string) (AgentApprovalContext, error) {
	return dh.consumeAgentApproval(approvalID, machineID, taskID)
}

// FailAgentApproval consumes a request when the daemon proves that the
// app-server decision write failed. This keeps the browser from displaying an
// approval that can no longer be applied while remaining fail-closed.
func (dh *DaemonHub) FailAgentApproval(approvalID, machineID, taskID string) (AgentApprovalContext, error) {
	return dh.consumeAgentApproval(approvalID, machineID, taskID)
}

func (dh *DaemonHub) consumeAgentApproval(approvalID, machineID, taskID string) (AgentApprovalContext, error) {
	dh.approvalMu.Lock()
	defer dh.approvalMu.Unlock()
	value, ok := dh.agentApprovals.Load(approvalID)
	if !ok {
		return AgentApprovalContext{}, errors.New("approval request not found")
	}
	approval := value.(AgentApprovalContext)
	if approval.MachineID != machineID || approval.TaskID != taskID {
		return AgentApprovalContext{}, errors.New("approval acknowledgement owner mismatch")
	}
	if !dh.agentApprovals.CompareAndDelete(approvalID, approval) {
		return AgentApprovalContext{}, errors.New("approval request already resolved")
	}
	dh.bumpApprovalRevisionLocked(approval.UserID, approval.ConversationID)
	return approval, nil
}

// Run 启动 DaemonHub 消息总线事件循环，应在独立 goroutine 中调用
func (dh *DaemonHub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			dh.shutdown()
			return
		case msg := <-dh.bus:
			dh.dispatch(msg)
		}
	}
}

// dispatch 根据消息类型分发处理
func (dh *DaemonHub) dispatch(msg daemonBusMsg) {
	switch msg.kind {
	case daemonBusRegister:
		dh.handleRegister(msg)
	case daemonBusUnregister:
		dh.handleUnregister(msg)
	}
}

func (dh *DaemonHub) handleRegister(msg daemonBusMsg) {
	dh.lifecycleMu.Lock()
	client := msg.payload.(*DaemonClient)
	if _, revoked := dh.revokedMachines.Load(client.MachineID); revoked {
		dh.lifecycleMu.Unlock()
		client.closeNow()
		return
	}
	// 若同一 machineID 已有旧连接，先关闭
	old, loaded := dh.clients.LoadAndDelete(client.MachineID)
	dh.clients.Store(client.MachineID, client)
	dh.lifecycleMu.Unlock()
	if loaded {
		oldClient := old.(*DaemonClient)
		// close 握手可等待数秒，不能阻塞 Hub 总线处理后续注销事件。
		oldClient.closeNow()
		dh.logger.Info("replaced old daemon connection", "machine_id", client.MachineID)
	}
	dh.logger.Info("daemon connected", "machine_id", client.MachineID)
}

// RevokeMachine 移除电脑后撤销旧连接，不等待在线状态或普通重连宽限期。
// 本机 CLI 停止属于尽力通知：网络已断开的进程无法由服务器保证终止。
func (dh *DaemonHub) RevokeMachine(machineID string) {
	dh.lifecycleMu.Lock()
	dh.revokedMachines.Store(machineID, true)
	connection, connected := dh.clients.LoadAndDelete(machineID)
	dh.lifecycleMu.Unlock()
	cancelCtx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	dh.taskMachines.Range(func(key, value interface{}) bool {
		if value == machineID {
			taskID := key.(string)
			if connected {
				client := connection.(*DaemonClient)
				if client.Conn != nil {
					cancelData, _ := dh.taskCancelData.Load(taskID)
					data, _ := json.Marshal(WSMessage{Type: "task.cancel", Data: cancelData})
					_ = client.Conn.Write(cancelCtx, websocket.MessageText, data)
				}
			}
			dh.ResolveTask(taskID, &TaskResult{TaskID: taskID, Error: "电脑连接已被移除"})
		}
		return true
	})
	if connected {
		connection.(*DaemonClient).close(websocket.StatusPolicyViolation, "machine removed")
	}
}

func (dh *DaemonHub) handleUnregister(msg daemonBusMsg) {
	client := msg.payload.(*DaemonClient)
	// 仅当 map 中的 client 与当前 client 一致时才删除（避免删除替代者）
	if loaded, ok := dh.clients.Load(client.MachineID); ok && loaded == client {
		dh.clients.Delete(client.MachineID)
		// 慢任务没有时长上限；只在连接持续丢失时结束等待。
		time.AfterFunc(daemonTaskDisconnectGrace, func() { dh.failDisconnectedTasks(client.MachineID) })
	}
	client.close(websocket.StatusNormalClosure, "disconnect")
	if !dh.draining.Load() {
		dh.wg.Done()
	}
	dh.logger.Info("daemon disconnected", "machine_id", client.MachineID)
}

// shutdown 优雅关闭：排空消息、关闭所有连接（通过 sync.Once 保证只执行一次）
func (dh *DaemonHub) shutdown() {
	dh.shutdownOnce.Do(func() {
		dh.logger.Info("daemon hub shutting down, draining messages")

		dh.draining.Store(true)

		// 排空待发消息（最多等待 2 秒）
		drainTimer := time.NewTimer(2 * time.Second)
		drainDone := false
		for !drainDone {
			select {
			case msg := <-dh.bus:
				dh.dispatch(msg)
			case <-drainTimer.C:
				drainDone = true
			}
		}

		// 关闭所有 daemon 连接
		dh.clients.Range(func(key, value interface{}) bool {
			client := value.(*DaemonClient)
			client.close(websocket.StatusNormalClosure, "server shutdown")
			return true
		})

		// 等待所有连接 goroutine 结束
		dh.wg.Wait()

		dh.logger.Info("daemon hub shutdown complete")
	})
}

// --- 公开 API ---

// Register 注册 daemon 连接（异步通过 bus）
func (dh *DaemonHub) Register(client *DaemonClient) {
	if !dh.draining.Load() {
		dh.wg.Add(1)
	}
	select {
	case dh.bus <- daemonBusMsg{kind: daemonBusRegister, payload: client}:
	default:
		if !dh.draining.Load() {
			dh.wg.Done()
		}
		dh.logger.Warn("daemon hub bus full, dropping register", "machine_id", client.MachineID)
	}
}

// Unregister 注销 daemon 连接（异步通过 bus）
func (dh *DaemonHub) Unregister(client *DaemonClient) {
	select {
	case dh.bus <- daemonBusMsg{kind: daemonBusUnregister, payload: client}:
	default:
		dh.logger.Warn("daemon hub bus full, force-closing connection", "machine_id", client.MachineID)
		client.close(websocket.StatusNormalClosure, "disconnect")
		if !dh.draining.Load() {
			dh.wg.Done()
		}
	}
}

// SendToMachine 向指定 daemon 发送消息（同步查询 + 异步写入）
func (dh *DaemonHub) SendToMachine(machineID string, msg WSMessage) error {
	dh.lifecycleMu.Lock()
	defer dh.lifecycleMu.Unlock()
	val, ok := dh.clients.Load(machineID)
	if !ok {
		return errors.New("daemon not connected: " + machineID)
	}
	client := val.(*DaemonClient)
	taskID := dh.trackTaskDispatch(machineID, msg)
	if err := client.Send(msg); err != nil {
		dh.taskMachines.Delete(taskID)
		dh.taskCancelData.Delete(taskID)
		return err
	}
	return nil
}

// SendToMachineRequiringCapability performs capability validation and enqueue
// against the exact same live connection, closing the replacement race between
// a preflight capability check and task dispatch.
func (dh *DaemonHub) SendToMachineRequiringCapability(machineID, capability string, msg WSMessage) error {
	dh.lifecycleMu.Lock()
	defer dh.lifecycleMu.Unlock()
	val, ok := dh.clients.Load(machineID)
	if !ok {
		return errors.New("daemon not connected: " + machineID)
	}
	taskID := dh.trackTaskDispatch(machineID, msg)
	if err := val.(*DaemonClient).sendRequiringCapability(capability, msg); err != nil {
		dh.taskMachines.Delete(taskID)
		dh.taskCancelData.Delete(taskID)
		return err
	}
	return nil
}

func (dh *DaemonHub) trackTaskDispatch(machineID string, msg WSMessage) string {
	if msg.Type != "task.dispatch" {
		return ""
	}
	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		return ""
	}
	taskID, _ := data["task_id"].(string)
	if taskID != "" {
		dh.taskMachines.Store(taskID, machineID)
		dh.taskCancelData.Store(taskID, map[string]interface{}{"task_id": taskID, "agent_id": data["agent_id"], "conversation_id": data["conversation_id"], "user_id": data["user_id"]})
	}
	return taskID
}

func (dh *DaemonHub) failDisconnectedTasks(machineID string) {
	if dh.IsConnected(machineID) || dh.draining.Load() {
		return
	}
	dh.taskMachines.Range(func(key, value interface{}) bool {
		if value == machineID {
			taskID := key.(string)
			dh.ResolveTask(taskID, &TaskResult{TaskID: taskID, Error: "Agent 所在电脑已断开连接，请重新连接后重试"})
		}
		return true
	})
}

// IsConnected 检查 daemon 是否 WS 连接中
func (dh *DaemonHub) IsConnected(machineID string) bool {
	_, ok := dh.clients.Load(machineID)
	return ok
}

// SupportsCapability checks the capability handshake on the currently active
// connection. This deliberately fails closed for older daemons that omit it.
func (dh *DaemonHub) SupportsCapability(machineID, capability string) bool {
	value, ok := dh.clients.Load(machineID)
	if !ok {
		return false
	}
	return value.(*DaemonClient).supportsCapability(capability)
}

// RegisterTaskPromise 创建并存储任务结果 channel（带 buffer=1）
func (dh *DaemonHub) RegisterTaskPromise(taskID string) chan *TaskResult {
	ch := make(chan *TaskResult, 1)
	dh.resultChans.Store(taskID, ch)
	return ch
}

// AwaitTaskResult 获取任务结果 promise channel
// 返回 nil 表示该任务在 WS 之前创建（无 promise）
func (dh *DaemonHub) AwaitTaskResult(taskID string) chan *TaskResult {
	val, ok := dh.resultChans.Load(taskID)
	if !ok {
		return nil
	}
	return val.(chan *TaskResult)
}

// ResolveTask 发送结果到 promise channel；清理由等待方 RemoveTaskPromise 完成。
func (dh *DaemonHub) ResolveTask(taskID string, result *TaskResult) {
	val, ok := dh.resultChans.Load(taskID)
	if !ok {
		return
	}
	ch := val.(chan *TaskResult)
	select {
	case ch <- result:
	default:
		// channel 已满（已有结果或无人消费），跳过
	}
}

// RemoveTaskPromise 清理 promise channel（超时场景）
func (dh *DaemonHub) RemoveTaskPromise(taskID string) {
	dh.resultChans.Delete(taskID)
	dh.taskMachines.Delete(taskID)
	dh.taskCancelData.Delete(taskID)
}

// RegisterTestClient inserts a client directly into the clients map.
// For use in tests only — bypasses the bus and avoids needing a real WebSocket.
func (dh *DaemonHub) RegisterTestClient(machineID string, client *DaemonClient) {
	dh.clients.Store(machineID, client)
}

// UpdateMachineID 更新 daemon 客户端的 machineID 标识（全局 token 连接时，收到
// daemon.register 后才知道真实 machineID，需要更新 DaemonHub 注册）。
func (dh *DaemonHub) UpdateMachineID(client *DaemonClient, newMachineID string) {
	oldID := client.MachineID
	if oldID == newMachineID {
		return
	}
	dh.clients.Delete(oldID)
	client.MachineID = newMachineID
	dh.clients.Store(newMachineID, client)
	dh.logger.Info("daemon machine_id updated", "old", oldID, "new", newMachineID)
}

// Shutdown 外部调用关闭 DaemonHub（委托给内部 shutdown，sync.Once 保证幂等）
func (dh *DaemonHub) Shutdown(ctx context.Context) {
	dh.shutdown()
}
