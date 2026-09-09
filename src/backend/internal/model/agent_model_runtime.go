package model

import "time"

type AgentModelRuntime struct {
	ConfiguredModel string    `json:"configured_model,omitempty" db:"configured_model"`
	ObservedModel   string    `json:"observed_model,omitempty" db:"observed_model"`
	ContextWindow   *int64    `json:"context_window,omitempty" db:"context_window"`
	ObservedAt      time.Time `json:"observed_at" db:"observed_at"`
}
