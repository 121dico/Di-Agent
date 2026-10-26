package handler

import (
	"net/http"

	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/gin-gonic/gin"
)

// hiveMachineRequester ties an Agent tool invocation to its authenticated
// machine owner. A caller-supplied user_id may never select another account.
func hiveMachineRequester(c *gin.Context, machine *model.DaemonMachine) (string, bool) {
	requesters := c.Request.URL.Query()["user_id"]
	if machine == nil || machine.UserID == "" || len(requesters) != 1 || requesters[0] != machine.UserID {
		middleware.ErrorResponse(c, http.StatusForbidden, 40372, "当前请求者与已认证电脑所属账号不一致")
		return "", false
	}
	return machine.UserID, true
}
