package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// BrowserIdentityProof 仅表示浏览器可访问该电脑的回环服务，绝不参与授权。
type BrowserIdentityProof struct {
	Nonce    string `json:"nonce"`
	IssuedAt int64  `json:"issued_at"`
	Proof    string `json:"proof"`
}

func (p BrowserIdentityProof) Valid() bool {
	for _, value := range []string{p.Nonce, p.Proof} {
		if len(value) != 64 || value != strings.ToLower(value) {
			return false
		}
		if _, err := hex.DecodeString(value); err != nil {
			return false
		}
	}
	return p.IssuedAt > 0
}

// VerifyBrowserIdentity 不使用 IP、主机名推断本机；只比对当前用户的在线电脑。
func (s *AgentService) VerifyBrowserIdentity(ctx context.Context, userID string, proof BrowserIdentityProof) (string, error) {
	now := time.Now().Unix()
	if userID == "" || !proof.Valid() || proof.IssuedAt < now-60 || proof.IssuedAt > now+5 {
		return "", nil
	}
	machines, err := s.repo.ListDaemonMachines(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("list browser identity machines: %w", err)
	}
	supplied, _ := hex.DecodeString(proof.Proof)
	matched := ""
	for _, machine := range machines {
		if machine.UserID != userID || machine.Status != "connected" || machine.APIKeyHash == "" {
			continue
		}
		mac := hmac.New(sha256.New, []byte(machine.APIKeyHash))
		fmt.Fprintf(mac, "di-agent-browser-identity-v1\n%s\n%d", proof.Nonce, proof.IssuedAt)
		if hmac.Equal(supplied, mac.Sum(nil)) && s.daemonHub != nil && s.daemonHub.IsConnected(machine.ID) {
			matched = machine.ID
		}
	}
	return matched, nil
}
