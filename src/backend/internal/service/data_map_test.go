package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestDataMapPersonalQuotaSpacesOutboundRequests(t *testing.T) {
	var mu sync.Mutex
	var calls []time.Time
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		calls = append(calls, time.Now())
		mu.Unlock()
		_, _ = w.Write([]byte(`{"meta":{"code":0},"data":{"list":[]}}`))
	}))
	defer upstream.Close()
	svc := NewDataMapService(DataMapConfig{BaseURL: upstream.URL, ClientID: "pilot", Token: "test-only", OwnerUserID: "owner"}, upstream.Client(), time.Now)
	for range 2 {
		result, err := svc.SearchHiveTables(context.Background(), "owner", DataMapHiveSearch{Prefix: "price"})
		if err != nil || result == nil || result.HasPrefixMatches || result.ResultScope != "requested_prefix_page" {
			t.Fatalf("valid empty list must only describe this page, result=%+v error=%v", result, err)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 2 || calls[1].Sub(calls[0]) < time.Second {
		t.Fatalf("personal source limit exceeded: calls=%v", calls)
	}
}
