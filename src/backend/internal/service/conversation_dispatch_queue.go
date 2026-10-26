package service

import (
	"sync"
)

// ConversationDispatchQueue 将入队顺序与执行顺序分开：引导不等待当前运行结束，
// 无法引导的消息按接收顺序执行。不同会话/Agent 互不阻塞。
type ConversationDispatchQueue struct {
	mu    sync.Mutex
	lanes map[string]*conversationDispatchLane
}

type conversationDispatchLane struct {
	submission chan struct{}
	execution  chan struct{}
	running    int
	references int
	steerReady bool
}

// Submit 的 trySteer 返回 true 表示已处理（成功或未确认），禁止重复调度。
func (q *ConversationDispatchQueue) Submit(key string, trySteer func() bool, run func(), onQueued ...func()) {
	q.submit([]string{key}, trySteer, func(ready func()) { ready(); run() }, onQueued...)
}

// SubmitWhenReady 等待外部任务时不得让后续引导越过已经排队的消息。
func (q *ConversationDispatchQueue) SubmitWhenReady(key string, trySteer func() bool, run func(func()), onQueued func()) {
	q.submit([]string{key}, trySteer, run, onQueued)
}

// SubmitMany 先同时预留所有目标，避免多 @ 消息绕过单目标队列。
func (q *ConversationDispatchQueue) SubmitMany(keys []string, run func(), onQueued func()) {
	q.SubmitManyWhenReady(keys, func(ready func()) { ready(); run() }, onQueued)
}

func (q *ConversationDispatchQueue) SubmitManyWhenReady(keys []string, run func(func()), onQueued func()) {
	unique := make([]string, 0, len(keys))
	seen := map[string]bool{}
	for _, key := range keys {
		if !seen[key] {
			seen[key] = true
			unique = append(unique, key)
		}
	}
	q.submit(unique, nil, run, onQueued)
}

func (q *ConversationDispatchQueue) submit(keys []string, trySteer func() bool, run func(func()), onQueued ...func()) {
	q.mu.Lock()
	if q.lanes == nil {
		q.lanes = make(map[string]*conversationDispatchLane)
	}
	var lanes []*conversationDispatchLane
	var previousSubmissions []chan struct{}
	submission := make(chan struct{})
	for _, key := range keys {
		lane := q.lanes[key]
		if lane == nil {
			lane = &conversationDispatchLane{}
			q.lanes[key] = lane
		}
		lanes = append(lanes, lane)
		previousSubmissions = append(previousSubmissions, lane.submission)
		lane.submission = submission
		lane.references++
	}
	q.mu.Unlock()
	go func() {
		for _, previousSubmission := range previousSubmissions {
			if previousSubmission != nil {
				<-previousSubmission
			}
		}
		q.mu.Lock()
		canSteer := len(lanes) == 1 && (lanes[0].running == 0 || (lanes[0].running == 1 && lanes[0].steerReady))
		q.mu.Unlock()
		if canSteer && trySteer != nil && trySteer() {
			close(submission)
			q.release(keys[0], lanes[0])
			return
		}
		q.mu.Lock()
		var previousExecutions []chan struct{}
		execution := make(chan struct{})
		for _, lane := range lanes {
			previousExecutions = append(previousExecutions, lane.execution)
			lane.execution = execution
			lane.running++
		}
		q.mu.Unlock()
		if len(onQueued) > 0 && onQueued[0] != nil {
			onQueued[0]()
		}
		close(submission)
		for _, previousExecution := range previousExecutions {
			if previousExecution != nil {
				<-previousExecution
			}
		}
		q.mu.Lock()
		for _, lane := range lanes {
			lane.steerReady = false
		}
		q.mu.Unlock()
		defer func() {
			q.mu.Lock()
			for _, lane := range lanes {
				lane.running--
				lane.steerReady = false
			}
			q.mu.Unlock()
			close(execution)
			for i, lane := range lanes {
				q.release(keys[i], lane)
			}
		}()
		run(func() {
			q.mu.Lock()
			for _, lane := range lanes {
				lane.steerReady = true
			}
			q.mu.Unlock()
		})
	}()
}

func (q *ConversationDispatchQueue) release(key string, lane *conversationDispatchLane) {
	q.mu.Lock()
	defer q.mu.Unlock()
	lane.references--
	if lane.references == 0 && q.lanes[key] == lane {
		delete(q.lanes, key)
	}
}
