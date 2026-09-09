package repository

import (
	"context"
	"fmt"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// 仅连接所属机器可上报配置；实际模型由已鉴权任务的原生用量更新。
func (r *AgentSessionRepo) SaveConfiguredModel(ctx context.Context, agentID, machineID, name string) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO agent_model_runtime(agent_id,configured_model)
 SELECT id,$3 FROM agents WHERE id=$1 AND machine_id=$2
 ON CONFLICT(agent_id) DO UPDATE SET configured_model=$3, observed_model='',context_window=NULL,observed_at=NOW()`, agentID, machineID, name)
	if err != nil {
		return fmt.Errorf("save configured model: %w", err)
	}
	return nil
}
func (r *AgentSessionRepo) SaveObservedModel(ctx context.Context, agentID string, u *model.TokenUsage) error {
	if u == nil || u.Model == "" {
		return nil
	}
	_, err := r.db.ExecContext(ctx, `INSERT INTO agent_model_runtime(agent_id,observed_model,context_window,observed_at)
 VALUES($1,$2,$3,$4) ON CONFLICT(agent_id) DO UPDATE SET observed_model=$2,context_window=$3,observed_at=$4
 WHERE agent_model_runtime.observed_model = '' OR agent_model_runtime.observed_at <= $4`, agentID, u.Model, u.ContextWindowTokens, u.ObservedAt)
	if err != nil {
		return fmt.Errorf("save observed model: %w", err)
	}
	return nil
}
