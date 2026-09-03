package brandenv

import "os"

const legacyPrefix = "AGENTHUB_" // [brand-compat] 旧 Go daemon 环境变量只读入口。

// Read 返回 canonical 环境变量，未设置时兼容读取旧部署变量。
func Read(suffix string) string {
	if value, ok := os.LookupEnv("DI_AGENT_" + suffix); ok {
		return value
	}
	return os.Getenv(legacyPrefix + suffix)
}
