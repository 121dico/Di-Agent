package service

import "github.com/121dico/Di-Agent/src/backend/internal/model"

// ResolvedDispatchTask is a dispatch assignment after resolving the target
// Agent name against the current group chat membership.
type ResolvedDispatchTask struct {
	DispatchTask
	AgentID string
}

// WorkerDispatchPlan separates valid worker assignments from references the
// orchestrator produced but the current group chat cannot execute.
type WorkerDispatchPlan struct {
	Tasks         []ResolvedDispatchTask
	UnknownTasks  []DispatchTask
	agentNameToID map[string]string
}

func BuildWorkerDispatchPlan(tasks []DispatchTask, convAgents []model.ConversationAgent) WorkerDispatchPlan {
	plan := WorkerDispatchPlan{
		Tasks:         make([]ResolvedDispatchTask, 0, len(tasks)),
		agentNameToID: buildAgentNameIDMap(convAgents),
	}
	for _, task := range tasks {
		agentID, ok := resolveDispatchAgentID(plan.agentNameToID, task.AgentName)
		if !ok {
			plan.UnknownTasks = append(plan.UnknownTasks, task)
			continue
		}
		plan.Tasks = append(plan.Tasks, ResolvedDispatchTask{
			DispatchTask: task,
			AgentID:      agentID,
		})
	}
	return plan
}

func (p WorkerDispatchPlan) HasWorkers() bool {
	return len(p.Tasks) > 0
}

// eligibleWorkerAgents excludes the active coordinator by identity as well as
// role. A stale conversation role must never turn the coordinator into a worker.
func eligibleWorkerAgents(convAgents []model.ConversationAgent, orchestratorID string) []model.ConversationAgent {
	workers := make([]model.ConversationAgent, 0, len(convAgents))
	for _, ca := range convAgents {
		if ca.AgentID == orchestratorID || ca.Role == "orchestrator" {
			continue
		}
		workers = append(workers, ca)
	}
	return workers
}

func buildAgentNameIDMap(convAgents []model.ConversationAgent) map[string]string {
	agentNameToID := make(map[string]string, len(convAgents)*2)
	for _, ca := range convAgents {
		if ca.Name == "" || ca.AgentID == "" || ca.Role == "orchestrator" {
			continue
		}
		agentNameToID[ca.Name] = ca.AgentID
		agentNameToID[normalizeMentionName(ca.Name)] = ca.AgentID
	}
	return agentNameToID
}

func resolveDispatchAgentID(agentNameToID map[string]string, agentName string) (string, bool) {
	if agentID, ok := agentNameToID[agentName]; ok {
		return agentID, true
	}
	agentID, ok := agentNameToID[normalizeMentionName(agentName)]
	return agentID, ok
}
