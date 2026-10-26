package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/port"
	"github.com/121dico/Di-Agent/src/backend/internal/repository"
)

type setupMachineStore struct {
	repository.AgentStore
	machine *model.DaemonMachine
}

func (s *setupMachineStore) GetDaemonMachineByID(context.Context, string) (*model.DaemonMachine, error) {
	return s.machine, nil
}

type setupControl struct {
	calls    int
	response string
	onCall   func()
	envelope json.RawMessage
	action   string
}

func (s *setupControl) RequestManagedMCP(_ context.Context, _, _, action string, envelope ...json.RawMessage) (json.RawMessage, error) {
	s.calls++
	s.action = action
	if len(envelope) == 1 {
		s.envelope = envelope[0]
	}
	if s.onCall != nil {
		s.onCall()
	}
	return json.RawMessage(s.response), nil
}

func fixtureMCPEnvelope() *ManagedMCPEnvelope {
	return &ManagedMCPEnvelope{SessionID: strings.Repeat("a", 43), ClientPublicKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), Nonce: base64.StdEncoding.EncodeToString(make([]byte, 24)), Ciphertext: base64.StdEncoding.EncodeToString(make([]byte, 32))}
}

func TestManagedMCPInlineRelayOnlyForValidEnvelopeAndOwner(t *testing.T) {
	store := &setupMachineStore{machine: &model.DaemonMachine{UserID: "owner"}}
	control := &setupControl{response: strings.Replace(strings.Replace(safeSetupResult, `"status":"connected"`, `"status":"configured_unverified","saved":true,"configuration_changed":true`, 1), `"checks":[{"id":"identity","status":"passed","code":"identity_verified"},{"id":"project","status":"unverified","code":"project_unverified"}]`, `"checks":[]`, 1)}
	svc := NewManagedMCPSetupService(store, control)
	for _, mutate := range []func(*ManagedMCPEnvelope){func(e *ManagedMCPEnvelope) { e.Nonce = "plaintext" }, func(e *ManagedMCPEnvelope) { e.Ciphertext = base64.StdEncoding.EncodeToString(make([]byte, 12289)) }, func(e *ManagedMCPEnvelope) { e.ClientPublicKey = "" }, func(e *ManagedMCPEnvelope) { e.SessionID = "short" }} {
		e := fixtureMCPEnvelope()
		mutate(e)
		if _, err := svc.Execute(context.Background(), "owner", "machine", "save", e); !errors.Is(err, ErrManagedMCPInvalidEnvelope) {
			t.Fatalf("invalid accepted: %v", err)
		}
	}
	if control.calls != 0 {
		t.Fatal("bad envelope dispatched")
	}
	if _, err := svc.Execute(context.Background(), "other", "machine", "save", fixtureMCPEnvelope()); !errors.Is(err, ErrManagedMCPNotFound) {
		t.Fatal(err)
	}
	result, err := svc.Execute(context.Background(), "owner", "machine", "save", fixtureMCPEnvelope())
	if err != nil || !result.Saved || result.Status != "configured_unverified" || control.action != "save" || !json.Valid(control.envelope) {
		t.Fatalf("relay failed %v %#v", err, result)
	}
	control.onCall = func() { store.machine = nil }
	if _, err := svc.Execute(context.Background(), "owner", "machine", "save", fixtureMCPEnvelope()); !errors.Is(err, ErrManagedMCPNotFound) {
		t.Fatal(err)
	}
}

func TestManagedMCPInlineSessionSanitizationAndFixedSaveErrors(t *testing.T) {
	store := &setupMachineStore{machine: &model.DaemonMachine{UserID: "owner"}}
	base := strings.Replace(safeSetupResult, `"status":"connected"`, `"status":"configured_unverified"`, 1)
	session := ManagedMCPSetupSession{ID: strings.Repeat("a", 43), PublicKey: base64.StdEncoding.EncodeToString(make([]byte, 32)), ExpiresAt: time.Now().Add(5 * time.Minute).UTC().Format(time.RFC3339Nano), Supported: true}
	makeResult := func(s ManagedMCPSetupSession) string {
		var result map[string]any
		_ = json.Unmarshal([]byte(base), &result)
		result["setup_session"] = s
		b, _ := json.Marshal(result)
		return string(b)
	}
	control := &setupControl{response: makeResult(session)}
	svc := NewManagedMCPSetupService(store, control)
	result, err := svc.Execute(context.Background(), "owner", "machine", "setup_session")
	if err != nil || result.SetupSession == nil || result.RequestID != "" {
		t.Fatalf("session failed %v", err)
	}
	if _, err := svc.Execute(context.Background(), "owner", "machine", "inspect"); !errors.Is(err, ErrManagedMCPInvalidResult) {
		t.Fatal("session leaked in inspect")
	}
	for _, mutate := range []func(*ManagedMCPSetupSession){func(s *ManagedMCPSetupSession) { s.PublicKey = "secret" }, func(s *ManagedMCPSetupSession) { s.ExpiresAt = time.Now().Add(-time.Minute).Format(time.RFC3339Nano) }, func(s *ManagedMCPSetupSession) { s.Reason = "raw upstream secret" }, func(s *ManagedMCPSetupSession) { s.Supported = false }} {
		s := session
		mutate(&s)
		control.response = makeResult(s)
		if _, err := svc.Execute(context.Background(), "owner", "machine", "setup_session"); !errors.Is(err, ErrManagedMCPInvalidResult) {
			t.Fatalf("unsafe accepted %v", err)
		}
	}
	control.response = makeResult(ManagedMCPSetupSession{Reason: "unsupported_platform"})
	if _, err := svc.Execute(context.Background(), "owner", "machine", "setup_session"); err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"session_expired", "invalid_envelope", "invalid_configuration", "environment_override", "unsupported_platform", "save_failed"} {
		control.response = strings.Replace(base, `"status":"configured_unverified"`, `"status":"failed","error_code":"`+code+`"`, 1)
		result, err := svc.Execute(context.Background(), "owner", "machine", "save", fixtureMCPEnvelope())
		if err != nil || result.ErrorCode != code || result.Saved {
			t.Fatalf("fixed error %s %v", code, err)
		}
	}
}

const safeSetupResult = `{"request_id":"request","status":"connected","checked_at":"2026-10-16T00:00:00Z","key_configured":true,"project_code":"epower_platform","credential_source":"keychain","project_source":"file","checks":[{"id":"identity","status":"passed","code":"identity_verified"},{"id":"project","status":"unverified","code":"project_unverified"}],"opened":false}`

func TestManagedMCPSetupAuthorizesOwnerBeforeDispatchAndAfterWait(t *testing.T) {
	store := &setupMachineStore{machine: &model.DaemonMachine{ID: "machine", UserID: "owner"}}
	control := &setupControl{response: safeSetupResult}
	svc := NewManagedMCPSetupService(store, control)
	if _, err := svc.Execute(context.Background(), "other", "machine", "inspect"); !errors.Is(err, ErrManagedMCPNotFound) || control.calls != 0 {
		t.Fatalf("owner bypass: %v", err)
	}
	result, err := svc.Execute(context.Background(), "owner", "machine", "inspect")
	if err != nil || result.Status != "connected" || result.RequestID != "" {
		t.Fatalf("unexpected result: %#v %v", result, err)
	}
	control.onCall = func() { store.machine = nil }
	if _, err := svc.Execute(context.Background(), "owner", "machine", "inspect"); !errors.Is(err, ErrManagedMCPNotFound) {
		t.Fatalf("removed machine returned success: %v", err)
	}
}

func TestManagedMCPSetupRejectsUntrustedFieldsAndFalseConnection(t *testing.T) {
	store := &setupMachineStore{machine: &model.DaemonMachine{UserID: "owner"}}
	cases := []string{
		`{"status":"connected","api_key":"secret"}`,
		`{"status":"connected","checked_at":"2026-10-16T00:00:00Z","credential_source":"keychain","project_source":"file","checks":[]}`,
		`{"status":"failed","checked_at":"2026-10-16T00:00:00Z","credential_source":"missing","project_source":"missing","error_code":"Bearer secret"}`,
		`{"status":"failed","checked_at":"2026-10-16T00:00:00Z","credential_source":"missing","project_source":"missing","project_code":"https://evil/secret"}`,
		`{"status":"failed","checked_at":"2026-10-16T00:00:00Z","credential_source":"missing","project_source":"missing","checks":[{"id":"project","status":"passed","code":"project_unverified"}]}`,
	}
	for _, raw := range cases {
		svc := NewManagedMCPSetupService(store, &setupControl{response: raw})
		if _, err := svc.Execute(context.Background(), "owner", "machine", "inspect"); !errors.Is(err, ErrManagedMCPInvalidResult) {
			t.Fatalf("unsafe result accepted: %v", err)
		}
	}
}

func TestManagedMCPSetupMinimalErrorsRemainActionable(t *testing.T) {
	store := &setupMachineStore{machine: &model.DaemonMachine{UserID: "owner"}}
	for _, tc := range []struct {
		code     string
		expected error
	}{{"busy", port.ErrManagedMCPBusy}, {"request_denied", ErrManagedMCPNotFound}} {
		svc := NewManagedMCPSetupService(store, &setupControl{response: `{"request_id":"request","status":"failed","error_code":"` + tc.code + `"}`})
		if _, err := svc.Execute(context.Background(), "owner", "machine", "inspect"); !errors.Is(err, tc.expected) {
			t.Fatalf("%s: %v", tc.code, err)
		}
	}
}
