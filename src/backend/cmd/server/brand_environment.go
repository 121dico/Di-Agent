package main

import "os"

const legacyEnvironmentPrefix = "AGENTHUB_" // [brand-compat] 仅兼容读取旧部署变量。

func readDiAgentEnv(suffix string) string {
	value, _ := lookupDiAgentEnv(suffix)
	return value
}

func lookupDiAgentEnv(suffix string) (string, bool) {
	if value, ok := os.LookupEnv("DI_AGENT_" + suffix); ok {
		return value, true
	}
	return os.LookupEnv(legacyEnvironmentPrefix + suffix)
}
