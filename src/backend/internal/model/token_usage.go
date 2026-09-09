package model

import "time"

// TokenUsage 仅携带原生计量。输入已包含缓存；nil 表示未上报，不能等同零。
// Complete 仅表示本次派发主循环统计完整，不代表账户账单或所有子代理。
type ContextEvent struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Status    string `json:"status"`
	StartedAt string `json:"started_at,omitempty"`
	EndedAt   string `json:"ended_at,omitempty"`
}

type TokenUsage struct {
	ContextEvents       []ContextEvent `json:"context_events,omitempty"`
	Provider            string         `json:"provider"`
	Source              string         `json:"source"`
	Model               string         `json:"model,omitempty"`
	InputTokens         *int64         `json:"input_tokens,omitempty"`
	OutputTokens        *int64         `json:"output_tokens,omitempty"`
	CacheReadTokens     *int64         `json:"cache_read_tokens,omitempty"`
	CacheWriteTokens    *int64         `json:"cache_write_tokens,omitempty"`
	ReasoningTokens     *int64         `json:"reasoning_tokens,omitempty"`
	ContextTokens       *int64         `json:"context_tokens,omitempty"`
	ContextWindowTokens *int64         `json:"context_window_tokens,omitempty"`
	Complete            bool           `json:"complete"`
	ObservedAt          time.Time      `json:"observed_at"`
}

// Valid 限制为 JS 安全整数并拒绝互相矛盾的细分值。
func (u *TokenUsage) Valid() bool {
	if u == nil || u.Source != "actual" || (u.Provider != "codex" && u.Provider != "claude") || u.ObservedAt.IsZero() {
		return false
	}
	if len(u.ContextEvents) > 64 {
		return false
	}
	for _, e := range u.ContextEvents {
		if e.ID == "" || len(e.ID) > 200 || e.Kind != "compaction" || (e.Status != "running" && e.Status != "complete") {
			return false
		}
		for _, v := range []string{e.StartedAt, e.EndedAt} {
			if v != "" {
				if _, err := time.Parse(time.RFC3339Nano, v); err != nil {
					return false
				}
			}
		}
	}
	for _, n := range []*int64{u.InputTokens, u.OutputTokens, u.CacheReadTokens, u.CacheWriteTokens, u.ReasoningTokens, u.ContextTokens, u.ContextWindowTokens} {
		if n != nil && (*n < 0 || *n > 9007199254740991) {
			return false
		}
	}
	if u.InputTokens != nil {
		var cached int64
		if u.CacheReadTokens != nil {
			cached += *u.CacheReadTokens
		}
		if u.CacheWriteTokens != nil {
			cached += *u.CacheWriteTokens
		}
		if cached > *u.InputTokens {
			return false
		}
	}
	if u.ReasoningTokens != nil && u.OutputTokens != nil && *u.ReasoningTokens > *u.OutputTokens {
		return false
	}
	return !u.Complete || (u.InputTokens != nil && u.OutputTokens != nil)
}
