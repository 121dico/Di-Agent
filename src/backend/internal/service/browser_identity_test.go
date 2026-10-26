package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestBrowserIdentityMatchesOnlyConnectedOwnedMachine(t *testing.T) {
	key := "test-machine-key"
	sign := func(issuedAt int64) BrowserIdentityProof {
		proof := BrowserIdentityProof{Nonce: strings.Repeat("a", 64), IssuedAt: issuedAt}
		mac := hmac.New(sha256.New, []byte(hashMachineAPIKey(key)))
		fmt.Fprintf(mac, "di-agent-browser-identity-v1\n%s\n%d", proof.Nonce, proof.IssuedAt)
		proof.Proof = hex.EncodeToString(mac.Sum(nil))
		return proof
	}
	proof := sign(time.Now().Unix())
	machine := model.DaemonMachine{ID: "machine-1", UserID: "owner", Status: "connected", APIKeyHash: hashMachineAPIKey(key)}
	repo := &fakeAgentRepo{machines: []model.DaemonMachine{machine}}
	svc := NewAgentService(repo, nil)
	svc.SetDaemonHub(&fakeDaemonDispatcher{isConnected: func(string) bool { return true }})
	id, err := svc.VerifyBrowserIdentity(context.Background(), "owner", proof)
	if err != nil || id != machine.ID {
		t.Fatalf("matched %q, %v", id, err)
	}
	for _, tc := range []struct {
		name, user string
		proof      BrowserIdentityProof
		status     string
	}{
		{"foreign owner", "other", proof, "connected"},
		{"offline", "owner", proof, "offline"},
		{"tampered", "owner", BrowserIdentityProof{Nonce: proof.Nonce, IssuedAt: proof.IssuedAt, Proof: strings.Repeat("0", 64)}, "connected"},
		{"expired", "owner", sign(proof.IssuedAt - 61), "connected"},
		{"future", "owner", sign(proof.IssuedAt + 30), "connected"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo.machines[0].Status = tc.status
			id, err := svc.VerifyBrowserIdentity(context.Background(), tc.user, tc.proof)
			if err != nil || id != "" {
				t.Fatalf("must not match: %q %v", id, err)
			}
		})
	}
	repo.machines[0].Status = "connected"
	svc.SetDaemonHub(&fakeDaemonDispatcher{isConnected: func(string) bool { return false }})
	if id, _ := svc.VerifyBrowserIdentity(context.Background(), "owner", proof); id != "" {
		t.Fatal("disconnected socket matched")
	}
}
