package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type fakeTaskRepo struct {
	mu              sync.Mutex
	task            *model.WorkspaceTask
	tasks           []*model.WorkspaceTask
	hashIdx         map[string]*model.WorkspaceTask
	updateWorkerErr error
}

func newFakeTaskRepo() *fakeTaskRepo {
	return &fakeTaskRepo{
		hashIdx: make(map[string]*model.WorkspaceTask),
	}
}

func (r *fakeTaskRepo) List(context.Context, string, model.TaskFilter) ([]*model.WorkspaceTask, error) {
	return []*model.WorkspaceTask{}, nil
}

func (r *fakeTaskRepo) Create(_ context.Context, userID string, input model.TaskCreateInput) (*model.WorkspaceTask, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.task = &model.WorkspaceTask{
		ID:             "task-1",
		UserID:         &userID,
		ConversationID: input.ConversationID,
		AgentID:        input.AgentID,
		Title:          input.Title,
		Description:    input.Description,
		Status:         input.Status,
		Priority:       input.Priority,
		OrchTaskID:     input.OrchTaskID,
		WorkerName:     input.WorkerName,
		TaskHash:       input.TaskHash,
	}
	r.tasks = append(r.tasks, r.task)
	if input.TaskHash != nil {
		r.hashIdx[*input.TaskHash] = r.task
	}
	return r.task, nil
}

func (r *fakeTaskRepo) GetByID(context.Context, string, string) (*model.WorkspaceTask, error) {
	return r.task, nil
}

func (r *fakeTaskRepo) Update(_ context.Context, _, _ string, input model.TaskUpdateInput) (*model.WorkspaceTask, error) {
	if r.task == nil {
		return nil, nil
	}
	if input.Title != nil {
		r.task.Title = *input.Title
	}
	if input.Priority != nil {
		r.task.Priority = *input.Priority
	}
	return r.task, nil
}

func (r *fakeTaskRepo) MoveStatus(_ context.Context, _, _, status string) (*model.WorkspaceTask, error) {
	if r.task == nil {
		return nil, nil
	}
	r.task.Status = status
	return r.task, nil
}

func (r *fakeTaskRepo) Delete(context.Context, string, string) (bool, error) {
	return r.task != nil, nil
}

func (r *fakeTaskRepo) GetByOrchTaskAndWorker(context.Context, string, string) (*model.WorkspaceTask, error) {
	return r.task, nil
}

func (r *fakeTaskRepo) GetByTaskHash(_ context.Context, hash string) (*model.WorkspaceTask, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if t, ok := r.hashIdx[hash]; ok {
		return t, nil
	}
	return nil, nil
}

func (r *fakeTaskRepo) FailAllByOrchTask(context.Context, string) error {
	return nil
}

func (r *fakeTaskRepo) UpdateWorkerResult(_ context.Context, _, result string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.updateWorkerErr != nil {
		return r.updateWorkerErr
	}
	if r.task == nil {
		return nil
	}
	r.task.WorkerResult = &result
	return nil
}

func TestCreateFromDaemonTaskSerializesConcurrentFirstCompletion(t *testing.T) {
	repo := newFakeTaskRepo()
	svc := NewTaskService(repo)
	daemonTask := &model.DaemonTask{
		ID:             "daemon-task-concurrent",
		UserID:         "user-1",
		ConversationID: "agent-conv-1",
		AgentID:        "agent-1",
		Prompt:         "并发完成任务",
	}

	start := make(chan struct{})
	errs := make(chan error, 2)
	var callers sync.WaitGroup
	callers.Add(2)
	for range 2 {
		go func() {
			defer callers.Done()
			<-start
			errs <- svc.CreateFromDaemonTask(context.Background(), daemonTask, "唯一结果", "")
		}()
	}
	close(start)
	callers.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent daemon task sync: %v", err)
		}
	}

	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.tasks) != 1 {
		t.Fatalf("tasks = %d, want exactly one", len(repo.tasks))
	}
	if repo.task.WorkerResult == nil || *repo.task.WorkerResult != "唯一结果" {
		t.Fatalf("worker_result = %v, want persisted result", repo.task.WorkerResult)
	}
}

func TestCreateFromDaemonTaskRetriesMissingWorkerResultWithoutDuplicating(t *testing.T) {
	repo := newFakeTaskRepo()
	repo.updateWorkerErr = errors.New("write failed")
	svc := NewTaskService(repo)
	daemonTask := &model.DaemonTask{
		ID:             "daemon-task-retry",
		UserID:         "user-1",
		ConversationID: "agent-conv-1",
		AgentID:        "agent-1",
		Prompt:         "生成结果",
	}

	if err := svc.CreateFromDaemonTask(context.Background(), daemonTask, "最终结果", ""); err == nil {
		t.Fatal("first worker_result write should fail")
	}
	if len(repo.tasks) != 1 {
		t.Fatalf("tasks after failed result write = %d, want 1", len(repo.tasks))
	}

	repo.updateWorkerErr = nil
	if err := svc.CreateFromDaemonTask(context.Background(), daemonTask, "最终结果", ""); err != nil {
		t.Fatalf("retry daemon task sync: %v", err)
	}
	if len(repo.tasks) != 1 {
		t.Fatalf("tasks after retry = %d, want no duplicate", len(repo.tasks))
	}
	if repo.task.WorkerResult == nil || *repo.task.WorkerResult != "最终结果" {
		t.Fatalf("worker_result after retry = %v", repo.task.WorkerResult)
	}
}

func TestTaskServiceCreateDefaults(t *testing.T) {
	svc := NewTaskService(newFakeTaskRepo())
	task, err := svc.Create(context.Background(), "user-1", model.TaskCreateInput{Title: "  设计任务看板  "})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}
	if task.Title != "设计任务看板" {
		t.Fatalf("expected trimmed title, got %q", task.Title)
	}
	if task.Status != "todo" || task.Priority != "medium" {
		t.Fatalf("unexpected defaults: %s/%s", task.Status, task.Priority)
	}
}

func TestTaskServiceRejectsInvalidStatus(t *testing.T) {
	svc := NewTaskService(newFakeTaskRepo())
	_, err := svc.MoveStatus(context.Background(), "user-1", "task-1", "unknown")
	if err != ErrTaskInvalid {
		t.Fatalf("expected ErrTaskInvalid, got %v", err)
	}
}

func TestCreateFromDaemonTaskPersistsLifecycleResult(t *testing.T) {
	repo := newFakeTaskRepo()
	svc := NewTaskService(repo)
	conversationID := "agent-conv-1"
	agentID := "agent-1"

	err := svc.CreateFromDaemonTask(context.Background(), &model.DaemonTask{
		ID:             "daemon-task-1",
		UserID:         "user-1",
		ConversationID: conversationID,
		AgentID:        agentID,
		Prompt:         "生成一份完整的任务同步报告",
	}, "报告生成完成", "")
	if err != nil {
		t.Fatalf("create daemon task: %v", err)
	}
	if repo.task == nil {
		t.Fatal("workspace task was not created")
	}
	if repo.task.Status != "done" || repo.task.WorkerResult == nil || *repo.task.WorkerResult != "报告生成完成" {
		t.Fatalf("workspace lifecycle = status %q result %v", repo.task.Status, repo.task.WorkerResult)
	}
	if repo.task.ConversationID == nil || *repo.task.ConversationID != conversationID {
		t.Fatalf("conversation_id = %v, want %q", repo.task.ConversationID, conversationID)
	}
	if repo.task.AgentID == nil || *repo.task.AgentID != agentID {
		t.Fatalf("agent_id = %v, want %q", repo.task.AgentID, agentID)
	}
}
