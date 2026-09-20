/* DiAgent runtime: exported report interactions + compatibility shims for agent-bridge.js. */
(function () {
  'use strict';

  var state = window.state || { ai: { question: "", answer: null } };
  if (state.ai === null || state.ai === undefined) state.ai = { question: "", answer: null };
  window.state = state;

  function one(selector, root) { return (root || document).querySelector(selector); }
  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function esc(value) {
    var text = value === null || value === undefined ? "" : String(value);
    var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    return text.replace(/[&<>"']/g, function (ch) { return map[ch]; });
  }
  function notify(message) {
    var toast = document.querySelector(".report-toast");
    if (toast === null || toast === undefined) {
      toast = document.createElement("div");
      toast.className = "report-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(function () {
      if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2600);
  }

  function render() {
    var card = document.getElementById("unifiedAiAnswer");
    if (card === null || card === undefined) return;
    var answer = state.ai.answer;
    if (answer === null || answer === undefined) {
      card.classList.add("hidden");
      card.innerHTML = "";
      return;
    }
    var question = String(state.ai.question || "").trim();
    var evidence = Array.isArray(answer.evidence) ? answer.evidence : [];
    var html = "<h3>" + esc(answer.title || "AI 分析") + "</h3>";
    if (question.length > 0) {
      html += "<div class=\"ai-section\"><strong>最新提问</strong><p>" + esc(question) + "</p></div>";
    }
    html += "<div class=\"ai-section\"><strong>分析结论</strong><p>" + esc(answer.answer || "").replace(/\n/g, "<br>") + "</p></div>";
    if (evidence.length > 0) {
      var labels = evidence.map(function (item) {
        if (typeof item === "string") return esc(item);
        if (item === null || item === undefined) return "";
        return esc(item.label || item.id || "");
      }).filter(function (label) { return label.length > 0; });
      if (labels.length > 0) {
        html += "<div class=\"ai-section\"><strong>结论依据</strong><p>" + labels.join(" · ") + "</p></div>";
      }
    }
    if (answer.scope) {
      html += "<div class=\"ai-section\"><strong>分析范围</strong><p>" + esc(answer.scope) + "</p></div>";
    }
    html += "<div class=\"ai-section\"><button class=\"link-button\" type=\"button\" id=\"unifiedAiDismiss\">收起</button></div>";
    card.innerHTML = html;
    card.classList.remove("hidden");
    var dismiss = document.getElementById("unifiedAiDismiss");
    if (dismiss) {
      dismiss.addEventListener("click", function () {
        state.ai.answer = null;
        render();
      });
    }
  }
  window.render = render;

  function fallbackAskAi(question) {
    var text = String(question || "").trim();
    state.ai.question = text;
    if (text === "") {
      state.ai.answer = { title: "需要一个问题", answer: "请输入你想分析的问题。", evidence: [] };
      render();
      return Promise.resolve(state.ai.answer);
    }
    state.ai.answer = {
      title: "AI 正在分析",
      answer: "正在读取当前投放任务数据，请稍候…",
      evidence: [],
      scope: "投放分析 · 规则兜底",
      streaming: true,
    };
    render();
    return fetch("/api/ai/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: text }),
    }).then(function (response) {
      if (response.ok === false) throw new Error("HTTP " + response.status);
      return response.json();
    }).then(function (payload) {
      var data = payload && payload.data !== undefined ? payload.data : payload;
      state.ai.answer = data || { title: "无结果", answer: "接口未返回数据。", evidence: [] };
      render();
      return state.ai.answer;
    }).catch(function (error) {
      state.ai.answer = {
        title: "分析失败",
        answer: String((error && error.message) || error),
        evidence: [],
      };
      render();
      throw error;
    });
  }
  window.askAi = fallbackAskAi;

  function moveUnifiedEntry() {
    var unified = document.querySelector('.unified-ai-entry');
    if (unified) unified.classList.add('ask-bar');
  }

  function wireAIEntry() {
    var input = document.getElementById("unifiedAiInput");
    var button = document.getElementById("unifiedAiButton");
    function submit() {
      var question = input ? String(input.value || "").trim() : "";
      if (question === "") {
        notify("请输入你想分析的问题");
        return;
      }
      if (input) input.value = "";
      Promise.resolve(window.askAi(question)).catch(function (error) {
        notify("AI 分析失败：" + String((error && error.message) || error));
      });
    }
    if (button) {
      button.type = "button";
      button.addEventListener("click", submit);
    }
    if (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        }
      });
    }
  }

  function initStageTabs() {
    var tabs = all("#stageTabs button");
    if (tabs.length === 0) return;
    function activate(phase) {
      tabs.forEach(function (button) {
        var active = button.dataset.phase === phase;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      var pre = document.getElementById("phase-pre");
      var monitor = document.getElementById("phase-monitor");
      if (pre) pre.classList.toggle("active", phase === "pre");
      if (monitor) monitor.classList.toggle("active", phase === "monitor");
      var title = document.getElementById("pageTitle");
      var description = document.getElementById("pageDescription");
      if (title) title.textContent = phase === "pre" ? "投放前 · 人群洞察" : "投放中/后 · 效果优化";
      if (description) {
        description.textContent = phase === "pre"
          ? "看清当前人群画像、实验分组和历史活动表现。"
          : "查看累计效果、分日异动和可下钻的标签拆解，并生成下次营销建议。";
      }
      var main = document.querySelector(".main-content");
      if (main && main.scrollTo) main.scrollTo({ top: 0, behavior: "smooth" });
    }
    tabs.forEach(function (button) {
      button.addEventListener("click", function () { activate(button.dataset.phase || "pre"); });
    });
    var firstActive = tabs.filter(function (button) { return button.classList.contains("active"); })[0] || tabs[0];
    activate(firstActive.dataset ? firstActive.dataset.phase || "pre" : "pre");
  }

  function initEffectViewTabs() {
    var tabs = all("#effectViewTabs button");
    if (tabs.length === 0) return;
    function activate(name) {
      name = name === "daily" ? "daily" : "cumulative";
      tabs.forEach(function (button) {
        var active = button.dataset.effectView === name;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      });
      // 原导出 HTML 的分日模块嵌套在累计容器中，切换时保留父容器才能显示分日模块。
      var effect = document.getElementById("subview-effect");
      effect.classList.remove("effect-view-realtime", "effect-view-daily");
      effect.style.display = "";
      effect.classList.add("active");
      Array.from(effect.children).forEach(function (child) {
        child.style.display = child.id === "subview-movement" ? (name === "daily" ? "" : "none") : (name === "cumulative" ? "" : "none");
      });
      var daily = document.getElementById("subview-movement");
      daily.classList.toggle("active", name === "daily");

    }
    tabs.forEach(function (button) {
      button.addEventListener("click", function () { activate(button.dataset.effectView || "cumulative"); });
    });
    var firstActive = tabs.filter(function (button) { return button.classList.contains("active"); })[0] || tabs[0];
    activate(firstActive.dataset ? firstActive.dataset.effectView || "cumulative" : "cumulative");
  }

  function initSidebar() {
    all(".task-node").forEach(function (button) {
      button.addEventListener("click", function () {
        all(".task-node").forEach(function (item) { item.classList.toggle("active", item === button); });
        all(".task-group").forEach(function (group) { group.classList.toggle("active", group.contains(button)); });
        if (button.dataset.taskName) {
          var taskName = document.getElementById("contextTaskName");
          if (taskName) taskName.textContent = button.dataset.taskName;
        }
      });
    });
    all(".audience-option").forEach(function (button) {
      button.addEventListener("click", function () {
        var group = button.closest(".task-group");
        if (group) {
          all(".audience-option", group).forEach(function (item) { item.classList.toggle("active", item === button); });
        }
        var label = String(button.textContent || "").trim();
        var inputName = document.getElementById("contextInputName");
        if (inputName && label.length > 0) inputName.textContent = label;
      });
    });
    all("[data-add-audience-task], .audience-actions button, .new-task-button").forEach(function (button) {
      button.addEventListener("click", function () {
        notify("任务与人群分析入口已保留，可在现有任务系统中扩展。");
      });
    });
  }

  function initToc() {
    all("#tocLinks button[data-toc-target]").forEach(function (button) {
      button.addEventListener("click", function () {
        var target = document.getElementById(button.dataset.tocTarget || "");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        all("#tocLinks button").forEach(function (item) { item.classList.toggle("active", item === button); });
      });
    });
  }

  function initButtonGroups() {
    var groups = [
      ["#breakdownDimensionButtons", "aria-selected"],
      ["#profileViewSwitch", "aria-selected"],
      ["#dimensionTabs", null],
      ["#baselineButtons", "aria-pressed"],
      ["#dailyFunnelSwitch", "aria-selected"],
      ["#dailyBreakdownTabs", "aria-selected"],
      [".group-filter", "aria-pressed"],
    ];
    groups.forEach(function (entry) {
      var container = document.querySelector(entry[0]);
      if (container === null || container === undefined) return;
      var buttons = all("button", container);
      if (buttons.length === 0) return;
      buttons.forEach(function (button) {
        button.addEventListener("click", function () {
          buttons.forEach(function (item) {
            var active = item === button;
            item.classList.toggle("active", active);
            if (entry[1]) item.setAttribute(entry[1], active ? "true" : "false");
          });
        });
      });
    });
  }

  function initGenericActions() {
    var messages = {


      configureReportModules: "模块配置入口已保留。",
      createTask: "新建任务入口已保留。",
      changeTask: "可在左侧任务树切换任务。",
      createCandidate: "历史活动尚未接入，暂不能生成候选条件。",
      showConclusionEvidence: "结论依据已在页面卡片中展示。",
      showMonitorEvidence: "效果分析依据已在页面卡片中展示。",
      showMovementEvidence: "分日分析依据已在页面卡片中展示。",
      exportDailyReport: "日报生成入口已保留。",
      customBreakdownDimension: "自定义维度入口已保留。",
      clearDrill: "已清空下钻路径。",
    };
    Object.keys(messages).forEach(function (id) {
      var button = document.getElementById(id);
      if (button === null || button === undefined) return;
      button.addEventListener("click", function () { notify(messages[id]); });
    });
    all(".breakdown-visual-row, .cause-row, .candidate-row, .profile-pie-item").forEach(function (item) {
      item.addEventListener("click", function () {
        if (item.classList.contains("candidate-row")) {
          all(".candidate-row").forEach(function (row) { row.classList.toggle("selected", row === item); });
        }
        if (item.classList.contains("cause-row")) {
          all(".cause-row").forEach(function (row) { row.classList.toggle("active", row === item); });
        }
      });
    });
  }

  function init() {
    moveUnifiedEntry();
    render();
    initStageTabs();
    initEffectViewTabs();
    initSidebar();
    initToc();
    initButtonGroups();
    initGenericActions();
    wireAIEntry();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
