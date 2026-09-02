INSERT INTO tool_categories (name, label, color, sort_order) VALUES
    ('report', '报表数据', '#f28c45', 9)
ON CONFLICT (name) DO NOTHING;

-- Keep built-in templates self-describing in the Agent configuration UI. The
-- daemon also treats these three governed tools as platform report hooks so
-- existing Agents receive the capability without being recreated.
UPDATE builtin_toolset_templates
SET tool_names = tool_names || '["discover_report_data","query_report_data","save_personal_report"]'::jsonb
WHERE name IN ('basic', 'tasks', 'orchestrator', 'agent_builder', 'agent_manager', 'knowledge')
  AND NOT tool_names @> '["discover_report_data","query_report_data","save_personal_report"]'::jsonb;

---- DOWN
UPDATE builtin_toolset_templates
SET tool_names = tool_names - 'discover_report_data' - 'query_report_data' - 'save_personal_report';
DELETE FROM tool_definitions WHERE name IN ('discover_report_data', 'query_report_data', 'save_personal_report');
DELETE FROM tool_categories WHERE name = 'report';
