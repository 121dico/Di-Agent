package port

import (
	"context"
	"encoding/json"
	"errors"
)

var (
	ErrManagedMCPOffline = errors.New("machine_offline")
	ErrManagedMCPUpgrade = errors.New("upgrade_required")
	ErrManagedMCPBusy    = errors.New("busy")
)

// ManagedMCPControl 只调度固定本机操作；可选载荷仅为一次性加密信封。
type ManagedMCPControl interface {
	RequestManagedMCP(ctx context.Context, machineID, userID, action string, envelope ...json.RawMessage) (json.RawMessage, error)
}
