package handler

import (
	"github.com/121dico/Di-Agent/src/backend/internal/middleware"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/gin-gonic/gin"
)

// ManagedMCPCatalog 仅分发无凭据目录；用户身份在本机安全助手中验证。
// 每次工具调用重新请求此端点，让电脑撤销和 owner 边界立即生效。
func ManagedMCPCatalog(c *gin.Context, machine *model.DaemonMachine) {
	if _, ok := internalSourceMachineRequester(c, machine); !ok {
		return
	}
	middleware.SuccessResponse(c, gin.H{
		"version": 1,
		"connectors": []gin.H{{
			"id": "datadream", "name": "数梦", "enabled": true,
			"purpose":   "查 Hive 表和字段、在公司服务端执行只读 SQL 并获取结果",
			"execution": "user_local", "transport": "streamable-http",
			"endpoint":        "http://127.0.0.1:28582/v1/datadream_mcp/datadream_mcp",
			"project_default": "epower_platform", "credential_binding": "datadream-personal",
			"allowed_tools": []string{"datamap_search_asset", "datamap_get_table_detail", "get_hive_table_partition_page_list", "check_sql_syntax", "run_sql", "get_sql_log", "get_sql_result"},
		}, {
			"id": "cooper", "name": "Cooper", "enabled": true,
			"purpose":   "读取本人有权限的公司文档和知识库目录；不开放写入、分享或权限修改",
			"execution": "user_local", "transport": "streamable-http",
			"endpoint":           "http://127.0.0.1:28582/v1/hub/cooper_mcp",
			"credential_binding": "company-personal",
			"allowed_tools":      []string{"readContent", "getKnowledgeDirectory"},
		}, {
			"id": "intranet-fetcher", "name": "内网页面检索", "enabled": true,
			"purpose": "通过 mcphub 官方连接器读取本人有权限的公司内网页面；只读，不上传浏览器 Cookie",
			"source": "mcphub", "source_url": "https://mcphub.intra.xiaojukeji.com/square/intranet-fetcher",
			"execution": "user_local", "transport": "stdio",
			"package": "@didi/intranet-fetcher-mcp", "version": "4.1.1",
			"credential_binding": "chrome-local-confirmed",
			"allowed_tools": []string{"fetch_intranet"},
		}},
	})
}
