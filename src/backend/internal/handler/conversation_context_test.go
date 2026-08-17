package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agent-hub/backend/internal/model"
	"github.com/agent-hub/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type fakeConversationContextHandlerService struct {
	conversationID       string
	sourceConversationID string
	checkpointID         string
	agentID              string
}

func (*fakeConversationContextHandlerService) Fork(context.Context, string, string, string, string, string) (*model.ConversationForkResult, error) {
	return &model.ConversationForkResult{Conversation: model.Conversation{ID: "child-1"}}, nil
}

func (*fakeConversationContextHandlerService) GetFork(context.Context, string, string) (*model.ConversationFork, error) {
	return nil, nil
}

func TestConversationContextHandlerForkContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/conversations/:id/forks", func(c *gin.Context) {
		c.Set("userID", "user-1")
		NewConversationContextHandler(&fakeConversationContextHandlerService{}).Fork(c)
	})
	request := httptest.NewRequest(http.MethodPost,
		"/conversations/11111111-1111-4111-8111-111111111111/forks",
		strings.NewReader(`{"checkpoint_id":"22222222-2222-4222-8222-222222222222","agent_id":"33333333-3333-4333-8333-333333333333"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "child-1") {
		t.Fatalf("Fork response = %d %s", response.Code, response.Body.String())
	}
}

func TestConversationContextHandlerForkRejectsInvalidConversationID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewConversationContextHandler(&fakeConversationContextHandlerService{})
	router := gin.New()
	router.POST("/conversations/:id/forks", handler.Fork)
	router.GET("/conversations/:id/fork", handler.GetFork)

	postRequest := httptest.NewRequest(http.MethodPost, "/conversations/not-a-uuid/forks",
		strings.NewReader(`{"checkpoint_id":"22222222-2222-4222-8222-222222222222","agent_id":"33333333-3333-4333-8333-333333333333"}`))
	postRequest.Header.Set("Content-Type", "application/json")
	postResponse := httptest.NewRecorder()
	router.ServeHTTP(postResponse, postRequest)
	if postResponse.Code != http.StatusBadRequest {
		t.Fatalf("POST status = %d, body = %s", postResponse.Code, postResponse.Body.String())
	}

	getResponse := httptest.NewRecorder()
	router.ServeHTTP(getResponse, httptest.NewRequest(http.MethodGet, "/conversations/not-a-uuid/fork", nil))
	if getResponse.Code != http.StatusBadRequest {
		t.Fatalf("GET status = %d, body = %s", getResponse.Code, getResponse.Body.String())
	}
}

func (f *fakeConversationContextHandlerService) Import(_ context.Context, _ string, targetConversationID, sourceConversationID, checkpointID, agentID string) (*service.ContinueConversationContextResult, error) {
	f.conversationID = targetConversationID
	f.sourceConversationID = sourceConversationID
	f.checkpointID = checkpointID
	f.agentID = agentID
	return &service.ContinueConversationContextResult{
		SessionID: "session-3", Generation: 1, CheckpointID: checkpointID,
	}, nil
}

func (*fakeConversationContextHandlerService) ListUsage(context.Context, string, string) ([]model.AgentSession, error) {
	return []model.AgentSession{{AgentID: "agent-1", Source: model.ContextUsageEstimated}}, nil
}

func TestConversationContextHandlerImportContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fake := &fakeConversationContextHandlerService{}
	handler := NewConversationContextHandler(fake)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user_id", "user-1")
		c.Next()
	})
	router.POST("/conversations/:id/checkpoint-imports", handler.Import)

	request := httptest.NewRequest(
		http.MethodPost,
		"/conversations/11111111-1111-4111-8111-111111111111/checkpoint-imports",
		strings.NewReader(`{"source_conversation_id":"22222222-2222-4222-8222-222222222222","checkpoint_id":"33333333-3333-4333-8333-333333333333","agent_id":"44444444-4444-4444-8444-444444444444"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if fake.conversationID != "11111111-1111-4111-8111-111111111111" ||
		fake.sourceConversationID != "22222222-2222-4222-8222-222222222222" ||
		fake.checkpointID != "33333333-3333-4333-8333-333333333333" ||
		fake.agentID != "44444444-4444-4444-8444-444444444444" {
		t.Fatalf("unexpected service input: %#v", fake)
	}
	if !strings.Contains(response.Body.String(), `"session_id":"session-3"`) {
		t.Fatalf("unexpected response: %s", response.Body.String())
	}
}

func (f *fakeConversationContextHandlerService) Continue(_ context.Context, _ string, conversationID, checkpointID, agentID string) (*service.ContinueConversationContextResult, error) {
	f.conversationID = conversationID
	f.checkpointID = checkpointID
	f.agentID = agentID
	return &service.ContinueConversationContextResult{
		SessionID: "session-2", Generation: 2, CheckpointID: checkpointID,
	}, nil
}

func TestConversationContextHandlerContinueContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fake := &fakeConversationContextHandlerService{}
	handler := NewConversationContextHandler(fake)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user_id", "user-1")
		c.Next()
	})
	router.POST("/conversations/:id/checkpoints/:checkpointId/continue", handler.Continue)

	request := httptest.NewRequest(http.MethodPost, "/conversations/conv-1/checkpoints/checkpoint-1/continue", strings.NewReader(`{"agent_id":"agent-2"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if fake.conversationID != "conv-1" || fake.checkpointID != "checkpoint-1" || fake.agentID != "agent-2" {
		t.Fatalf("unexpected service input: %#v", fake)
	}
	if !strings.Contains(response.Body.String(), `"session_id":"session-2"`) {
		t.Fatalf("unexpected response: %s", response.Body.String())
	}
}
