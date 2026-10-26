package ws

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/121dico/Di-Agent/src/backend/internal/port"
	pkgws "github.com/121dico/Di-Agent/src/backend/pkg/ws"
)

// ManagedMCPControlAdapter 连接应用服务与守护进程传输。
type ManagedMCPControlAdapter struct{ hub *pkgws.DaemonHub }

func NewManagedMCPControlAdapter(hub *pkgws.DaemonHub) *ManagedMCPControlAdapter {
	return &ManagedMCPControlAdapter{hub: hub}
}

func (a *ManagedMCPControlAdapter) RequestManagedMCP(ctx context.Context, machineID, userID, action string, envelope ...json.RawMessage) (json.RawMessage, error) {
	result, err := a.hub.RequestManagedMCP(ctx, machineID, userID, action, envelope...)
	switch {
	case errors.Is(err, pkgws.ErrManagedMCPOffline):
		return nil, port.ErrManagedMCPOffline
	case errors.Is(err, pkgws.ErrManagedMCPUpgrade):
		return nil, port.ErrManagedMCPUpgrade
	case errors.Is(err, pkgws.ErrManagedMCPBusy):
		return nil, port.ErrManagedMCPBusy
	default:
		return result, err
	}
}
