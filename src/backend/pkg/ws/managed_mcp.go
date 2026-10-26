package ws

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
)

var (
	ErrManagedMCPOffline = errors.New("machine_offline")
	ErrManagedMCPUpgrade = errors.New("upgrade_required")
	ErrManagedMCPBusy    = errors.New("busy")
)

type managedMCPPending struct {
	client *DaemonClient
	result chan json.RawMessage
}

// RequestManagedMCP 将请求绑定到同一条连接；断开、超时及返回均释放等待项。
func (dh *DaemonHub) RequestManagedMCP(ctx context.Context, machineID, userID, action string, envelope ...json.RawMessage) (json.RawMessage, error) {
	if action != "inspect" && action != "configure" && action != "setup_session" && action != "save" {
		return nil, errors.New("invalid_action")
	}
	if len(envelope) > 1 || (action == "save" && len(envelope) != 1) || (action != "save" && len(envelope) != 0) {
		return nil, errors.New("invalid_envelope")
	}
	if _, loaded := dh.managedMCPMachines.LoadOrStore(machineID, true); loaded {
		return nil, ErrManagedMCPBusy
	}
	defer dh.managedMCPMachines.Delete(machineID)
	dh.lifecycleMu.Lock()
	value, exists := dh.clients.Load(machineID)
	if !exists {
		dh.lifecycleMu.Unlock()
		return nil, ErrManagedMCPOffline
	}
	client := value.(*DaemonClient)
	if !client.supportsCapability("managed_mcp_v1") || !client.supportsCapability("managed_mcp_setup_v1") {
		dh.lifecycleMu.Unlock()
		return nil, ErrManagedMCPUpgrade
	}
	if (action == "save" || action == "setup_session") && !client.supportsCapability("managed_mcp_inline_setup_v1") {
		dh.lifecycleMu.Unlock()
		return nil, ErrManagedMCPUpgrade
	}
	requestID := uuid.NewString()
	pending := &managedMCPPending{client: client, result: make(chan json.RawMessage, 1)}
	dh.managedMCPPending.Store(requestID, pending)
	defer dh.managedMCPPending.Delete(requestID)
	data := map[string]any{"request_id": requestID, "user_id": userID}
	if action == "save" || action == "setup_session" {
		data["machine_id"] = machineID
	}
	if action == "save" {
		data["envelope"] = envelope[0]
	}
	err := client.Send(WSMessage{Type: "managed_mcp." + action, Data: data})
	dh.lifecycleMu.Unlock()
	if err != nil {
		return nil, ErrManagedMCPOffline
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-client.done:
		return nil, ErrManagedMCPOffline
	case result := <-pending.result:
		return result, nil
	}
}

// ResolveManagedMCP 拒绝旧连接、另一台电脑、过期或超大响应；不记录原始内容。
func (dh *DaemonHub) ResolveManagedMCP(client *DaemonClient, data json.RawMessage) {
	if len(data) > 8192 {
		return
	}
	var envelope struct {
		RequestID string `json:"request_id"`
	}
	if json.Unmarshal(data, &envelope) != nil {
		return
	}
	value, ok := dh.managedMCPPending.Load(envelope.RequestID)
	if !ok {
		return
	}
	pending := value.(*managedMCPPending)
	if pending.client != client {
		return
	}
	current, ok := dh.clients.Load(client.MachineID)
	if !ok || current != client {
		return
	}
	select {
	case pending.result <- append(json.RawMessage(nil), data...):
	default:
	}
}
