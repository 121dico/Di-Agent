package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// TaskRepo 定义任务服务依赖的数据访问能力。
type TaskRepo interface {
	List(ctx context.Context, userID string, filter model.TaskFilter) ([]*model.WorkspaceTask, error)
	Create(ctx context.Context, userID string, input model.TaskCreateInput) (*model.WorkspaceTask, error)
	GetByID(ctx context.Context, userID, id string) (*model.WorkspaceTask, error)
	GetByOrchTaskAndWorker(ctx context.Context, orchTaskID, workerName string) (*model.WorkspaceTask, error)
	GetByTaskHash(ctx context.Context, taskHash string) (*model.WorkspaceTask, error)
	Update(ctx context.Context, userID, id string, input model.TaskUpdateInput) (*model.WorkspaceTask, error)
	MoveStatus(ctx context.Context, userID, id, status string) (*model.WorkspaceTask, error)
	Delete(ctx context.Context, userID, id string) (bool, error)
	FailAllByOrchTask(ctx context.Context, orchTaskID string) error
	UpdateWorkerResult(ctx context.Context, id, result string) error
}

// OrchTaskCardRepo 定义 orch_task_cards 表的数据访问能力。
type OrchTaskCardRepo interface {
	Create(ctx context.Context, card *model.OrchTaskCard) error
	GetByTaskHash(ctx context.Context, taskHash string) (*model.OrchTaskCard, error)
	ListByConversation(ctx context.Context, conversationID string) ([]*model.OrchTaskCard, error)
	UpdateStatus(ctx context.Context, id, status string) error
	UpdateWorkerResult(ctx context.Context, id, result string) error
	FailAllByOrchTask(ctx context.Context, orchTaskID string) error
}

// TaskBoardSync 定义 Orchestrator 到 TaskBoard 的同步接口。
type TaskBoardSync interface {
	CreateOrchWorkerTask(ctx context.Context, card *model.OrchTaskCard) (*model.OrchTaskCard, error)
	UpdateOrchWorkerStatus(ctx context.Context, taskHash, status, result string) error
	FailAllTasksForOrchTask(ctx context.Context, orchTaskID string) error
	ListOrchTaskCards(ctx context.Context, conversationID string) ([]*model.OrchTaskCard, error)
}

var (
	ErrTaskNotFound = errors.New("任务不存在")
	ErrTaskInvalid  = errors.New("任务参数不合法")
)

// TaskService 处理任务看板业务逻辑。
type TaskService struct {
	repo            TaskRepo
	orchCardRepo    OrchTaskCardRepo
	daemonSyncMu    sync.Mutex
	daemonSyncLocks map[string]*daemonTaskSyncLock
}

type daemonTaskSyncLock struct {
	mu   sync.Mutex
	refs int
}

// NewTaskService 创建任务服务。
func NewTaskService(repo TaskRepo) *TaskService {
	return &TaskService{
		repo:            repo,
		daemonSyncLocks: make(map[string]*daemonTaskSyncLock),
	}
}

// lockDaemonTaskHash 把同一 daemon task 的查询、创建和结果补写串成一个临界区。
// 锁表属于当前 TaskService 实例，不引入包级全局状态；引用归零后立即回收。
func (s *TaskService) lockDaemonTaskHash(taskHash string) func() {
	s.daemonSyncMu.Lock()
	lock := s.daemonSyncLocks[taskHash]
	if lock == nil {
		lock = &daemonTaskSyncLock{}
		s.daemonSyncLocks[taskHash] = lock
	}
	lock.refs++
	s.daemonSyncMu.Unlock()

	lock.mu.Lock()
	return func() {
		lock.mu.Unlock()
		s.daemonSyncMu.Lock()
		lock.refs--
		if lock.refs == 0 {
			delete(s.daemonSyncLocks, taskHash)
		}
		s.daemonSyncMu.Unlock()
	}
}

// SetOrchCardRepo 注入 orch_task_cards 仓库。
func (s *TaskService) SetOrchCardRepo(repo OrchTaskCardRepo) {
	s.orchCardRepo = repo
}

// GetByID 按 ID 查询任务。
func (s *TaskService) GetByID(ctx context.Context, userID, id string) (*model.WorkspaceTask, error) {
	task, err := s.repo.GetByID(ctx, userID, id)
	if err != nil {
		return nil, fmt.Errorf("get task: %w", err)
	}
	if task == nil {
		return nil, ErrTaskNotFound
	}
	return task, nil
}

// List 查询任务。
func (s *TaskService) List(ctx context.Context, userID string, filter model.TaskFilter) ([]*model.WorkspaceTask, error) {
	if filter.Status != "" && !isTaskStatus(filter.Status) {
		return nil, ErrTaskInvalid
	}
	tasks, err := s.repo.List(ctx, userID, filter)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}
	if tasks == nil {
		tasks = []*model.WorkspaceTask{}
	}
	return tasks, nil
}

// Create 创建任务。
// CreateFromDaemonTask 把已完成的 daemon 任务同步到任务看板（幂等：task_hash 去重）。
// title/description 保存任务要求，worker_result 保存完成结果或错误；failed 状态标 blocked。
func (s *TaskService) CreateFromDaemonTask(ctx context.Context, t *model.DaemonTask, result, taskErr string) error {
	if t == nil || t.ID == "" || t.UserID == "" {
		return nil
	}
	taskHash := "daemon-" + t.ID
	unlock := s.lockDaemonTaskHash(taskHash)
	defer unlock()

	existing, err := s.repo.GetByTaskHash(ctx, taskHash)
	if err != nil {
		return fmt.Errorf("find daemon workspace task: %w", err)
	}
	trim := func(str string, max int) string {
		runes := []rune(str)
		if len(runes) > max {
			return string(runes[:max]) + "…"
		}
		return str
	}
	status := "done"
	workerResult := result
	if taskErr != "" {
		status = "blocked"
		workerResult = taskErr
	}
	workerResult = trim(workerResult, 2000)
	// 创建成功但结果写入失败时，daemon 可能重发 task.complete。已有卡片仍需补写
	// worker_result，不能因 task_hash 已存在而永久留下没有明细的任务。
	if existing != nil {
		if existing.WorkerResult != nil && *existing.WorkerResult == workerResult {
			return nil
		}
		if err := s.repo.UpdateWorkerResult(ctx, existing.ID, workerResult); err != nil {
			return fmt.Errorf("repair daemon workspace result: %w", err)
		}
		return nil
	}
	convID := t.ConversationID
	agentID := t.AgentID
	var orchTaskID *string
	if t.OrchTaskID != "" {
		orchTaskID = &t.OrchTaskID
	}
	var workerName *string
	if t.WorkerName != "" {
		workerName = &t.WorkerName
	}
	created, err := s.repo.Create(ctx, t.UserID, model.TaskCreateInput{
		ConversationID: &convID,
		AgentID:        &agentID,
		Title:          trim(t.Prompt, 80),
		Description:    trim(t.Prompt, 500),
		Status:         status,
		Priority:       "medium",
		OrchTaskID:     orchTaskID,
		WorkerName:     workerName,
		TaskHash:       &taskHash,
	})
	if err != nil {
		return fmt.Errorf("create daemon workspace task: %w", err)
	}
	if created == nil || created.ID == "" {
		return fmt.Errorf("create daemon workspace task: empty task")
	}
	if err := s.repo.UpdateWorkerResult(ctx, created.ID, workerResult); err != nil {
		return fmt.Errorf("persist daemon workspace result: %w", err)
	}
	return nil
}

func (s *TaskService) Create(ctx context.Context, userID string, input model.TaskCreateInput) (*model.WorkspaceTask, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	if input.Title == "" || len(input.Title) > 120 {
		return nil, ErrTaskInvalid
	}
	if input.Status == "" {
		input.Status = "todo"
	}
	if input.Priority == "" {
		input.Priority = "medium"
	}
	if !isTaskStatus(input.Status) || !isTaskPriority(input.Priority) {
		return nil, ErrTaskInvalid
	}
	task, err := s.repo.Create(ctx, userID, input)
	if err != nil {
		return nil, fmt.Errorf("create task: %w", err)
	}
	return task, nil
}

// Update 更新任务内容。
func (s *TaskService) Update(ctx context.Context, userID, id string, input model.TaskUpdateInput) (*model.WorkspaceTask, error) {
	if input.Title != nil {
		title := strings.TrimSpace(*input.Title)
		if title == "" || len(title) > 120 {
			return nil, ErrTaskInvalid
		}
		input.Title = &title
	}
	if input.Description != nil {
		description := strings.TrimSpace(*input.Description)
		input.Description = &description
	}
	if input.Priority != nil && !isTaskPriority(*input.Priority) {
		return nil, ErrTaskInvalid
	}
	task, err := s.repo.Update(ctx, userID, id, input)
	if err != nil {
		return nil, fmt.Errorf("update task: %w", err)
	}
	if task == nil {
		return nil, ErrTaskNotFound
	}
	return task, nil
}

// validTaskTransitions defines legal state transitions for workspace tasks.
// Each key is a source status; the value maps target statuses that are allowed.
var validTaskTransitions = map[string]map[string]bool{
	"todo":        {"in_progress": true, "cancelled": true},
	"in_progress": {"done": true, "blocked": true, "cancelled": true},
	"blocked":     {"in_progress": true, "cancelled": true},
	"done":        {},
	"cancelled":   {},
}

// MoveStatus 流转任务状态。
func (s *TaskService) MoveStatus(ctx context.Context, userID, id, status string) (*model.WorkspaceTask, error) {
	if !isTaskStatus(status) {
		return nil, ErrTaskInvalid
	}
	// Fetch current task to validate state transition.
	// Although the handler layer may have already fetched the task for permission
	// checks, this read is intentionally kept here because the repo-level
	// MoveStatus performs a direct SQL UPDATE without knowing the current status,
	// so the service layer must read it to enforce the state machine.
	current, err := s.repo.GetByID(ctx, userID, id)
	if err != nil {
		return nil, fmt.Errorf("get task for status check: %w", err)
	}
	if current == nil {
		return nil, ErrTaskNotFound
	}
	allowed, exists := validTaskTransitions[current.Status]
	if !exists {
		return nil, ErrTaskInvalid
	}
	if !allowed[status] {
		return nil, ErrTaskInvalid
	}
	task, err := s.repo.MoveStatus(ctx, userID, id, status)
	if err != nil {
		return nil, fmt.Errorf("move task status: %w", err)
	}
	if task == nil {
		return nil, ErrTaskNotFound
	}
	return task, nil
}

// Delete 删除任务。
func (s *TaskService) Delete(ctx context.Context, userID, id string) error {
	ok, err := s.repo.Delete(ctx, userID, id)
	if err != nil {
		return fmt.Errorf("delete task: %w", err)
	}
	if !ok {
		return ErrTaskNotFound
	}
	return nil
}

// computeTaskHash 生成任务内容的短 hash，用于跨轮次去重。
// 输出 16 hex chars（64 bits），在单次 OrchTask 内 worker 数量（通常 < 100）下碰撞概率极低，
// 远低于生日攻击阈值（~2^32 条才会 50% 碰撞概率），对本场景完全安全。
func computeTaskHash(orchTaskID, workerName, title string) string {
	h := sha256.Sum256([]byte(orchTaskID + ":" + workerName + ":" + title))
	return hex.EncodeToString(h[:])[:16]
}

// CreateOrchWorkerTask Orch 派发时创建任务卡片。
// 幂等：基于内容 hash 查重，相同任务描述不会覆盖，而是直接返回已有卡片。
func (s *TaskService) CreateOrchWorkerTask(ctx context.Context, card *model.OrchTaskCard) (*model.OrchTaskCard, error) {
	if s.orchCardRepo == nil {
		return nil, fmt.Errorf("orch card repo not initialized")
	}

	// 用 hash 查重：相同任务描述 → 幂等返回
	existing, err := s.orchCardRepo.GetByTaskHash(ctx, card.TaskHash)
	if err != nil {
		return nil, fmt.Errorf("check task hash: %w", err)
	}
	if existing != nil {
		slog.Info("CreateOrchWorkerTask: returned existing card", "card_id", existing.ID, "task_hash", card.TaskHash, "worker", card.WorkerName)
		return existing, nil
	}

	// 创建新卡片
	if err := s.orchCardRepo.Create(ctx, card); err != nil {
		return nil, fmt.Errorf("create orch worker task card: %w", err)
	}
	slog.Info("CreateOrchWorkerTask: created card", "card_id", card.ID, "task_hash", card.TaskHash, "worker", card.WorkerName)
	return card, nil
}

// UpdateOrchWorkerStatus Worker 状态变化时更新，通过 taskHash 精确定位。
func (s *TaskService) UpdateOrchWorkerStatus(ctx context.Context, taskHash, status, result string) error {
	if s.orchCardRepo == nil {
		return fmt.Errorf("orch card repo not initialized")
	}

	card, err := s.orchCardRepo.GetByTaskHash(ctx, taskHash)
	if err != nil {
		return fmt.Errorf("lookup card by hash: %w", err)
	}
	if card == nil {
		slog.Warn("UpdateOrchWorkerStatus: card not found by hash", "task_hash", taskHash, "status", status, "result_len", len(result))
		return nil
	}
	slog.Info("UpdateOrchWorkerStatus: found card", "card_id", card.ID, "task_hash", taskHash, "status", status, "result_len", len(result))

	if err := s.orchCardRepo.UpdateStatus(ctx, card.ID, status); err != nil {
		return fmt.Errorf("update orch worker status: %w", err)
	}
	// Store worker_result when reaching a terminal state with content
	if (status == "done" || status == "failed") && result != "" {
		if err := s.orchCardRepo.UpdateWorkerResult(ctx, card.ID, result); err != nil {
			slog.Error("store worker_result FAILED", "card_id", card.ID, "error", err)
			return fmt.Errorf("store worker result: %w", err)
		}
		slog.Info("UpdateOrchWorkerStatus: stored worker_result", "card_id", card.ID, "result_len", len(result))
	}
	return nil
}

// FailAllTasksForOrchTask 将指定 orch_task_id 下所有未完成的 OrchTaskCard 标记为 failed。
func (s *TaskService) FailAllTasksForOrchTask(ctx context.Context, orchTaskID string) error {
	if s.orchCardRepo == nil {
		return fmt.Errorf("orch card repo not initialized")
	}
	if err := s.orchCardRepo.FailAllByOrchTask(ctx, orchTaskID); err != nil {
		return fmt.Errorf("fail all cards for orch task: %w", err)
	}
	return nil
}

// ListOrchTaskCards 查询指定会话的所有 Orch 任务卡片。
func (s *TaskService) ListOrchTaskCards(ctx context.Context, conversationID string) ([]*model.OrchTaskCard, error) {
	if s.orchCardRepo == nil {
		return nil, fmt.Errorf("orch card repo not initialized")
	}
	cards, err := s.orchCardRepo.ListByConversation(ctx, conversationID)
	if err != nil {
		return nil, fmt.Errorf("list orch task cards: %w", err)
	}
	return cards, nil
}

func isTaskStatus(status string) bool {
	switch status {
	case "todo", "in_progress", "blocked", "done", "cancelled":
		return true
	default:
		return false
	}
}

func isTaskPriority(priority string) bool {
	switch priority {
	case "low", "medium", "high":
		return true
	default:
		return false
	}
}
