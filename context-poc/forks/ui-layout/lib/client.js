window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-layout",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
		* LG breakpoint); a manual toggle below it re-expands over the squeezed center
		* (stores.ts narrowExpanded). */
		const SIDEBAR_AUTO_COLLAPSE = 1024;
		/**
		* Clamp a panel width into its contract range.
		* @param px - requested width.
		* @param min - range lower bound.
		* @param max - range upper bound.
		* @returns the clamped width.
		*/
		function clampWidth(px, min, max) {
			return Math.min(max, Math.max(min, Math.round(px)));
		}
		/**
		* Solve the three column widths for one viewport frame. Pure: no hysteresis —
		* the output is a function of (viewport, preferences) only, so recovery on
		* re-widening is automatic. Preferences re-clamp here because they cross the
		* store boundary and callers may still supply stale ranges.
		* @param viewport - available frame width in px.
		* @param sidebar - sidebar width preference in px (0 = closed).
		* @param details - details width preference in px (0 = closed).
		* @returns resolved widths; details 0 means visually closed (never unmounted), while a closed sidebar keeps its compact rail.
		*/
		function computeColumns(viewport, sidebar, details) {
			const s = sidebar === 0 ? 56 : clampWidth(sidebar, 264, 420);
			const d0 = details === 0 ? 0 : clampWidth(details, 300, 520);
			if (s + d0 + 640 <= viewport) return {
				sidebar: s,
				center: viewport - s - d0,
				details: d0
			};
			const d1 = d0 === 0 ? 0 : Math.max(300, viewport - s - 640);
			if (s + d1 + 640 <= viewport) return {
				sidebar: s,
				center: 640,
				details: d1
			};
			return {
				sidebar: s,
				center: Math.max(0, viewport - s),
				details: 0
			};
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.module.css.mjs
		const css = ".pI_x6G_frame{background:var(--dsw-alias-bg-base);height:100%;transition:grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out);grid-template-rows:100%;display:grid;position:relative;overflow:hidden}.pI_x6G_frame[data-dragging]{transition:none}@media (prefers-reduced-motion:reduce){.pI_x6G_frame{transition:none}}.pI_x6G_sidebarCol{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);min-width:0;overflow:hidden}.pI_x6G_centerCol{flex-direction:column;min-width:0;display:flex;overflow:hidden}.pI_x6G_detailsCol{border-left:1px solid var(--dsw-alias-border-l2);min-width:0;overflow:hidden}.pI_x6G_frame[data-details-collapsed] .pI_x6G_detailsCol{border-left:none}.pI_x6G_handle{cursor:col-resize;z-index:2;touch-action:none;width:8px;transition:left var(--ds-transition-duration-slow) var(--ds-ease-in-out);margin-left:-4px;position:absolute;top:0;bottom:0}.pI_x6G_frame[data-dragging] .pI_x6G_handle{transition:none}@media (prefers-reduced-motion:reduce){.pI_x6G_handle{transition:none}}.pI_x6G_handle[data-side=details]:after{content:\"\";box-sizing:border-box;background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2-darkmode-thin);opacity:0;width:12px;height:32px;transition:opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out), background var(--ds-transition-duration-slow) var(--ds-ease-in-out);border-radius:10px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}.pI_x6G_detailsCol:hover~.pI_x6G_handle[data-side=details]:after,.pI_x6G_handle[data-side=details]:hover:after,.pI_x6G_handle[data-side=details][data-dragging=true]:after{opacity:1}.pI_x6G_handle[data-side=details]:hover:after,.pI_x6G_handle[data-side=details][data-dragging=true]:after{background:var(--dsw-alias-button-floating-hover);border-color:var(--dsw-alias-border-l3)}.pI_x6G_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}.pI_x6G_overlayLayer>*{pointer-events:auto}";
		const whaledockCss = `.wd10-left{background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);min-width:0;height:100%;display:flex;flex-direction:column;overflow:hidden}.wd10-switch{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:12px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}.wd10-switch button{border:0;border-radius:7px;padding:7px 10px;color:var(--dsw-alias-fg-secondary);background:transparent;font:inherit;font-size:13px;cursor:pointer}.wd10-switch button[aria-selected=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-fg-primary);box-shadow:0 1px 3px rgba(0,0,0,.08)}.wd10-library{min-height:0;overflow:auto;padding:0 10px 18px}.wd10-libraryHead{padding:8px 6px 10px}.wd10-eyebrow{font-size:11px;letter-spacing:.08em;color:var(--dsw-alias-fg-tertiary);text-transform:uppercase}.wd10-libraryHead h2{font-size:17px;line-height:1.35;margin:4px 0;color:var(--dsw-alias-fg-primary)}.wd10-libraryHead p{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-project{width:100%;text-align:left;border:1px solid transparent;border-radius:10px;padding:10px;margin:2px 0 6px;background:transparent;color:inherit;cursor:pointer}.wd10-project:hover{background:var(--dsw-alias-bg-layer-1)}.wd10-project[aria-current=true]{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2)}.wd10-projectTitle{display:block;font-size:13px;font-weight:600;color:var(--dsw-alias-fg-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd10-projectMeta{display:flex;align-items:center;gap:7px;margin-top:5px;font-size:11px;color:var(--dsw-alias-fg-tertiary)}.wd10-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-fg-tertiary)}.wd10-dot[data-running=true]{background:#22a06b}.wd10-detail{min-width:0;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border-right:1px solid var(--dsw-alias-border-l2);overflow:hidden}.wd10-detailHead{padding:26px 24px 14px}.wd10-detailHead h1{font-size:22px;line-height:1.25;margin:5px 0 7px;color:var(--dsw-alias-fg-primary)}.wd10-detailHead p{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-tabs{display:flex;gap:3px;padding:0 20px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow:auto}.wd10-tabs button{border:0;border-bottom:2px solid transparent;padding:10px 8px 9px;background:transparent;color:var(--dsw-alias-fg-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.wd10-tabs button[aria-selected=true]{border-bottom-color:var(--dsw-alias-fg-primary);color:var(--dsw-alias-fg-primary)}.wd10-panel{min-height:0;overflow:auto;padding:20px 24px 28px}.wd10-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-layer-1);margin-bottom:12px}.wd10-card h3{font-size:14px;margin:0 0 7px;color:var(--dsw-alias-fg-primary)}.wd10-card p{font-size:12px;line-height:1.65;margin:0;color:var(--dsw-alias-fg-secondary)}.wd10-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:13px}.wd10-stat{padding:10px;border-radius:9px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}.wd10-stat strong{display:block;font-size:18px;color:var(--dsw-alias-fg-primary)}.wd10-stat span{font-size:11px;color:var(--dsw-alias-fg-tertiary)}.wd10-action{width:100%;border:1px solid var(--dsw-alias-interactive-bg-hover);border-radius:9px;padding:10px 12px;margin-top:9px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}.wd10-action:hover{background:var(--dsw-alias-interactive-bg-hover)}.wd10-action small{display:block;margin-top:3px;color:var(--dsw-alias-fg-secondary)}.wd10-feedback{font-size:12px;line-height:1.5;margin:12px 1px 0;color:var(--dsw-alias-fg-secondary)}.wd10-chat{min-width:0;height:100%;display:flex;overflow:hidden}.wd10-chatMain{min-width:0;flex:1;display:flex;flex-direction:column;overflow:hidden}.wd10-empty{padding:24px;color:var(--dsw-alias-fg-secondary);font-size:13px;line-height:1.6}@media(max-width:1120px){.wd10-detailHead{padding:20px 18px 12px}.wd10-panel{padding:16px 18px}.wd10-detailHead h1{font-size:19px}.wd10-tabs{padding:0 14px}}`;
		const whaledockGuardCss = `.wd10-leftViews,.wd10-leftView,.wd10-nativeSidebar{min-height:0;flex:1;overflow:hidden}.wd10-leftView[hidden],.wd10-nativeSidebar[hidden]{display:none}.wd10-subSwitch{margin-top:0}.wd10-projectPath{display:block;margin-top:3px;font-size:10px;color:var(--dsw-alias-fg-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wd10-banner,.wd10-hint{display:flex;align-items:center;gap:8px;margin:10px 18px 0;padding:9px 10px;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:9px;color:var(--dsw-alias-fg-primary);background:var(--dsw-alias-state-warn-tertiary);font-size:12px;line-height:1.45}.wd10-banner span,.wd10-hint span{min-width:0;flex:1}.wd10-banner button,.wd10-hint button{flex:none;border:1px solid currentColor;border-radius:7px;padding:4px 8px;background:transparent;color:inherit;cursor:pointer}.wd10-banner button:disabled,.wd10-action:disabled{opacity:.55;cursor:default}.wd10-prefStatus{margin:0 14px 8px;color:var(--dsw-alias-state-warn-primary);font-size:11px}.wd10-contentDetails{transition:width var(--ds-transition-duration-slow) var(--ds-ease-in-out);flex-shrink:0}`;
		const tagId = "@deepseek-ai/dsh-client-ui-layout/AppFrame.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-layout";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css + whaledockCss + whaledockGuardCss;
			document.head.appendChild(tag);
		}
		var AppFrame_module_css_default = {
			"centerCol": "pI_x6G_centerCol",
			"detailsCol": "pI_x6G_detailsCol",
			"frame": "pI_x6G_frame",
			"handle": "pI_x6G_handle",
			"overlayLayer": "pI_x6G_overlayLayer",
			"sidebarCol": "pI_x6G_sidebarCol"
		};
		//#endregion
		//#region lib/types/client/AppFrame.js
		/**
		* Three-column shell frame, registered into the built-in 'root' slot (the web
		* shell renders only 'root'). Owns the grid tracks (sidebar | center |
		* details), the drag handles (pointer capture + rAF throttle), the concession
		* chain (columns.ts), and the child-slot render decisions: the sidebar slot
		* renders HERE with live parameters from the concession solve, and the
		* session-aware occupants render in fixed column positions; strict entries
		* gate themselves on current-session availability while session-maybe
		* entries retain identity. Pure component: everything arrives
		* through the three framework shares — zero cordis or framework imports,
		* zero self-made hooks.
		*/
		/** Center column grid item (session-body building block). */
		function CenterColumn(props) {
			return (0, react_jsx_runtime.jsx)("div", {
				className: AppFrame_module_css_default.centerCol,
				children: props.children
			});
		}
		/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
		function DetailsColumn(props) {
			return (0, react_jsx_runtime.jsx)("div", {
				...props,
				className: props.className ? `${AppFrame_module_css_default.detailsCol} ${props.className}` : AppFrame_module_css_default.detailsCol,
				children: props.children
			});
		}
		/**
		* One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
		* `side` keys the hover-reveal CSS to the owning column.
		*/
		function DragHandle(props) {
			const [dragging, setDragging] = (0, react.useState)(false);
			const origin = (0, react.useRef)(0);
			const latest = (0, react.useRef)(0);
			const frame = (0, react.useRef)(null);
			const callbacks = (0, react.useRef)({
				onStart: props.onStart,
				onDrag: props.onDrag,
				onEnd: props.onEnd
			});
			callbacks.current = {
				onStart: props.onStart,
				onDrag: props.onDrag,
				onEnd: props.onEnd
			};
			const onPointerDown = (0, react.useCallback)((e) => {
				e.preventDefault();
				e.currentTarget.setPointerCapture(e.pointerId);
				origin.current = e.clientX;
				latest.current = e.clientX;
				callbacks.current.onStart();
				setDragging(true);
			}, []);
			const onPointerMove = (0, react.useCallback)((e) => {
				if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
				latest.current = e.clientX;
				frame.current ??= requestAnimationFrame(() => {
					frame.current = null;
					callbacks.current.onDrag(latest.current - origin.current);
				});
			}, []);
			const onPointerUp = (0, react.useCallback)((e) => {
				if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
				e.currentTarget.releasePointerCapture(e.pointerId);
				if (frame.current !== null) {
					cancelAnimationFrame(frame.current);
					frame.current = null;
				}
				callbacks.current.onDrag(latest.current - origin.current);
				setDragging(false);
				callbacks.current.onEnd();
			}, []);
			return (0, react_jsx_runtime.jsx)("div", {
				className: AppFrame_module_css_default.handle,
				style: { left: props.left },
				"data-side": props.side,
				"data-dragging": dragging || void 0,
				onPointerDown,
				onPointerMove,
				onPointerUp
			});
		}
		const CREATOR_TABS = [
			["overview", "概览"], ["script", "脚本"], ["shoot", "拍摄"],
			["publish", "发布"], ["review", "复盘"]
		];
		function normalizeProjectPath(cwd) {
			if (typeof cwd !== "string" || cwd === "") return "";
			const unified = cwd.replaceAll("\\", "/");
			const withoutTail = unified === "/" ? unified : unified.replace(/\/+$/u, "");
			return /^[A-Za-z]:$/u.test(withoutTail) ? `${withoutTail}/` : withoutTail || "/";
		}
		function projectPathTail(cwd) {
			const normalized = normalizeProjectPath(cwd);
			const parts = normalized.split("/").filter(Boolean);
			return normalized === "" ? "" : parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : normalized;
		}
		function projectTitle(cwd, fallback) {
			return normalizeProjectPath(cwd).split("/").filter(Boolean).at(-1) || fallback;
		}
		function finalizeProject(project, current) {
			const ordered = [...project.sessions].sort((a, b) => {
				if (a.id === current) return -1;
				if (b.id === current) return 1;
				const aTime = Number.isFinite(a.updatedAt) ? a.updatedAt : -Infinity, bTime = Number.isFinite(b.updatedAt) ? b.updatedAt : -Infinity;
				return bTime - aTime || String(a.id).localeCompare(String(b.id));
			});
			project.representativeId = ordered[0]?.id;
			project.updatedAt = ordered.reduce((latest, session) => Number.isFinite(session.updatedAt) ? Math.max(latest, session.updatedAt) : latest, 0);
			return project;
		}
		function creatorProjects(state, workspaces) {
			const groups = /* @__PURE__ */ new Map();
			const claimed = /* @__PURE__ */ new Set();
			for (const workspace of workspaces.items) {
				const workspacePath = normalizeProjectPath(workspace.path);
				const project = {
					key: `workspace:${String(workspace.workspaceId)}`,
					workspaceId: workspace.workspaceId,
					title: workspace.title || "未命名项目",
					pathTail: projectPathTail(workspacePath),
					sessions: [],
					sessionIds: [],
					running: false,
					updatedAt: 0,
					representativeId: void 0
				};
				for (const id of workspace.sessionIds) {
					const session = state.byId[id];
					if (session === void 0 || session.origin === "subagent") continue;
					claimed.add(id);
					project.sessions.push(session);
					project.sessionIds.push(id);
					project.running ||= session.running === true;
				}
				groups.set(project.key, project);
			}
			for (const id of state.ids) {
				const session = state.byId[id];
				if (session === void 0 || session.origin === "subagent" || claimed.has(id)) continue;
				const normalizedCwd = normalizeProjectPath(session.cwd);
				const sourceKey = normalizedCwd || `session:${String(id)}`;
				const key = `cwd:${sourceKey}`;
				let project = groups.get(key);
				if (project === void 0) {
					project = {
						key,
						title: projectTitle(normalizedCwd, session.displayTitle),
						pathTail: projectPathTail(normalizedCwd),
						sessions: [],
						sessionIds: [],
						running: false,
						updatedAt: 0,
						representativeId: void 0
					};
					groups.set(key, project);
				}
				project.sessions.push(session);
				project.sessionIds.push(id);
				project.running ||= session.running === true;
			}
			return [...groups.values()].map((project) => finalizeProject(project, state.current)).sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
		}
		function CreatorSidebar({ projects, activeKey, onSelect }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "wd10-library",
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: "wd10-libraryHead",
					children: [(0, react_jsx_runtime.jsx)("div", { className: "wd10-eyebrow", children: "WhaleDock" }), (0, react_jsx_runtime.jsx)("h2", { children: "内容库" }), (0, react_jsx_runtime.jsx)("p", { children: projects.length === 0 ? "建立或打开一个会话后，项目会出现在这里。" : `已聚合 ${projects.length} 个项目，可以跨项目切换。` })]
				}), ...projects.map((project) => (0, react_jsx_runtime.jsxs)("button", {
				className: "wd10-project",
				type: "button",
				"aria-current": project.key === activeKey,
				onClick: () => onSelect(project),
				children: [(0, react_jsx_runtime.jsx)("span", { className: "wd10-projectTitle", children: project.title }), (0, react_jsx_runtime.jsxs)("span", {
					className: "wd10-projectMeta",
					children: [(0, react_jsx_runtime.jsx)("span", { className: "wd10-dot", "data-running": project.running || void 0 }), (0, react_jsx_runtime.jsx)("span", { children: `${project.sessions.length} 个会话` }), project.running && (0, react_jsx_runtime.jsx)("span", { children: "进行中" })]
				}), project.pathTail && (0, react_jsx_runtime.jsx)("span", { className: "wd10-projectPath", children: project.pathTail })]
			}, project.key))]
			});
		}
		function stageCopy(tab, title) {
			const prompts = {
				overview: `请帮我梳理「${title}」当前进展，只列出下一个最值得推进的决策。`,
				script: `请继续打磨「${title}」的脚本，先核对当前稿件，再给出可直接拍摄的改稿建议。`,
				shoot: `请为「${title}」生成本次拍摄的最小清单：镜头、口播、素材和收工检查。`,
				publish: `请检查「${title}」发布前还缺什么，区分本地准备、平台操作和人工确认。`,
				review: `请带我复盘「${title}」，先问我一个最关键的结果问题，等我回答后再继续。`
			};
			return Object.prototype.hasOwnProperty.call(prompts, tab) ? prompts[tab] : prompts.overview;
		}
		function draftFeedback(result) {
			if (result?.ok === true) return "已填入右侧输入框；确认后直接发送。";
			if (result?.code === "draft-not-empty") return "右侧已有未发送内容，为避免覆盖，本次没有填入。";
			if (result?.code === "workspace-unavailable") return "项目工作区暂时不可用，没有创建或切换会话。";
			if (result?.code === "session-unavailable" && result.reason === "service") return "会话服务尚未就绪，请稍后重试。";
			if (result?.code === "session-unavailable" && result.reason === "input") return "会话已建立，但输入框尚未挂载；本次没有写入或切换。";
			if (result?.code === "session-unavailable") return "这个项目没有可用的代表会话，或目标会话已经失效。";
			return "操作没有完成，请稍后重试。";
		}
		function CreatorDetail({ project, tab, onTab, projectActions, alignment, onAlign }) {
			const [feedback, setFeedback] = (0, react.useState)(""), [pending, setPending] = (0, react.useState)(false);
				const pendingRef = (0, react.useRef)(false), feedbackAttempt = (0, react.useRef)(0), pendingAbort = (0, react.useRef)(null);
				(0, react.useEffect)(() => { feedbackAttempt.current += 1; pendingAbort.current?.abort(); pendingAbort.current = null; pendingRef.current = false; setPending(false); setFeedback(""); return () => { feedbackAttempt.current += 1; pendingAbort.current?.abort(); pendingAbort.current = null; pendingRef.current = false; }; }, [project?.key, tab]);
			if (project === void 0) return (0, react_jsx_runtime.jsx)("div", { className: "wd10-detail", children: (0, react_jsx_runtime.jsx)("div", { className: "wd10-empty", children: "还没有可展示的项目。先在右侧建立一个会话，鲸坞会自动把它归入内容库。" }) });
			const fillDraft = async () => {
					if (pendingRef.current) return;
					pendingRef.current = true; setPending(true);
					const operation = new AbortController(); pendingAbort.current = operation;
					const attempt = ++feedbackAttempt.current; setFeedback("正在对账项目与右侧会话…");
					try {
						const result = await projectActions.fillDraft(project.representativeId, stageCopy(tab, project.title), project.workspaceId, operation.signal);
						if (feedbackAttempt.current === attempt) setFeedback(draftFeedback(result));
				} catch (_error) {
					if (feedbackAttempt.current === attempt) setFeedback("操作意外中断，请重试；本次没有自动发送。");
				} finally {
						if (pendingAbort.current === operation) { pendingAbort.current = null; pendingRef.current = false; setPending(false); }
				}
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "wd10-detail",
				children: [alignment && (0, react_jsx_runtime.jsxs)("div", { className: "wd10-banner", role: "alert", children: [(0, react_jsx_runtime.jsxs)("span", { children: ["右栏当前在《", alignment.currentTitle, "》，不是你选的《", project.title, "》。", alignment.error || ""] }), (0, react_jsx_runtime.jsx)("button", { type: "button", disabled: alignment.pending, onClick: onAlign, children: alignment.pending ? "正在对齐…" : "一键对齐" })] }), (0, react_jsx_runtime.jsxs)("header", {
					className: "wd10-detailHead",
					children: [(0, react_jsx_runtime.jsx)("div", { className: "wd10-eyebrow", children: "当前项目" }), (0, react_jsx_runtime.jsx)("h1", { children: project.title }), (0, react_jsx_runtime.jsx)("p", { children: `${project.sessions.length} 个会话已聚合 · ${project.running ? "有任务正在进行" : "可继续推进"}` })]
				}), (0, react_jsx_runtime.jsx)("nav", {
					className: "wd10-tabs",
					"aria-label": "项目阶段",
					children: CREATOR_TABS.map(([id, label]) => (0, react_jsx_runtime.jsx)("button", { type: "button", "aria-selected": tab === id, onClick: () => onTab(id), children: label }, id))
				}), (0, react_jsx_runtime.jsxs)("main", {
					className: "wd10-panel",
					children: [(0, react_jsx_runtime.jsxs)("section", {
						className: "wd10-card",
						children: [(0, react_jsx_runtime.jsx)("h3", { children: CREATOR_TABS.find(([id]) => id === tab)?.[1] || "概览" }), (0, react_jsx_runtime.jsx)("p", { children: "工作台和原生对话同屏。点击下方操作会先对账项目会话，再把任务放入右侧草稿，不覆盖已有草稿。" }), (0, react_jsx_runtime.jsxs)("div", { className: "wd10-stats", children: [(0, react_jsx_runtime.jsxs)("div", { className: "wd10-stat", children: [(0, react_jsx_runtime.jsx)("strong", { children: project.sessions.length }), (0, react_jsx_runtime.jsx)("span", { children: "项目会话" })] }), (0, react_jsx_runtime.jsxs)("div", { className: "wd10-stat", children: [(0, react_jsx_runtime.jsx)("strong", { children: project.running ? "1" : "0" }), (0, react_jsx_runtime.jsx)("span", { children: "进行中" })] })] })]
					}), (0, react_jsx_runtime.jsxs)("section", {
						className: "wd10-card",
						children: [(0, react_jsx_runtime.jsx)("h3", { children: "与 AI 继续" }), (0, react_jsx_runtime.jsxs)("button", { className: "wd10-action", type: "button", disabled: pending, "aria-busy": pending || void 0, onClick: fillDraft, children: [pending ? "正在填入…" : "填入右侧草稿", (0, react_jsx_runtime.jsx)("small", { children: "你确认后才会发送，不会自动投递" })] }), feedback && (0, react_jsx_runtime.jsx)("p", { className: "wd10-feedback", role: "status", children: feedback })]
					})]
				})]
			});
		}
		/** The three-column frame (see module doc). */
		function AppFrame({ useStore, useSessions, useWorkspaces, actions, renderSlot, projectActions }) {
			const panels = useStore((s) => s);
			const sessionState = useSessions((s) => s);
			const workspaceState = useWorkspaces((s) => s);
			const projects = (0, react.useMemo)(() => creatorProjects(sessionState, workspaceState), [sessionState, workspaceState]);
			const preferences = projectActions.preferences;
			const [mode, setMode] = (0, react.useState)("sessions"), [hintSeen, setHintSeen] = (0, react.useState)(false);
			const [preferenceError, setPreferenceError] = (0, react.useState)(""), [contentLeftView, setContentLeftView] = (0, react.useState)("library");
			const [activeProjectKey, setActiveProjectKey] = (0, react.useState)(null), [creatorTab, setCreatorTab] = (0, react.useState)("overview");
			const [alignmentPending, setAlignmentPending] = (0, react.useState)(false), [alignmentError, setAlignmentError] = (0, react.useState)("");
				const alignmentAttempt = (0, react.useRef)(0), alignmentCurrent = (0, react.useRef)(sessionState.current);
				const currentProject = sessionState.current === void 0 ? void 0 : projects.find((project) => project.sessionIds.includes(sessionState.current)), currentProjectKey = currentProject?.key || null;
				(0, react.useLayoutEffect)(() => {
					if (Object.is(alignmentCurrent.current, sessionState.current)) return;
					alignmentCurrent.current = sessionState.current;
					alignmentAttempt.current += 1;
					setAlignmentPending(false); setAlignmentError("");
				}, [sessionState.current]);
			(0, react.useEffect)(() => {
				if (preferences === void 0) return;
				const sync = (value) => {
					let snapshot = value;
					try { snapshot = snapshot && typeof snapshot === "object" ? snapshot : preferences.getSnapshot(); } catch (_error) { setPreferenceError("视图偏好暂时不可用。"); return; }
					if (snapshot?.contentViewMode === "content" || snapshot?.contentViewMode === "sessions") setMode(snapshot.contentViewMode);
					if (typeof snapshot?.contentViewHintSeen === "boolean") setHintSeen(snapshot.contentViewHintSeen);
				};
				sync();
				try {
					const unsubscribe = preferences.subscribe(sync);
					return typeof unsubscribe === "function" ? unsubscribe : void 0;
				} catch (_error) { setPreferenceError("视图偏好暂时不可用。"); }
			}, [preferences]);
			(0, react.useEffect)(() => {
				if (projects.some((project) => project.key === activeProjectKey)) return;
				alignmentAttempt.current += 1;
				setAlignmentPending(false); setAlignmentError("");
				setActiveProjectKey(projects.find((project) => project.key === currentProjectKey)?.key || projects[0]?.key || null);
			}, [projects, activeProjectKey, currentProjectKey]);
			const writePreference = async (patch) => {
				if (preferences === void 0 || typeof preferences.write !== "function") { setPreferenceError("当前视图已切换，但偏好未保存。"); return; }
				try {
					const result = await preferences.write(patch);
					setPreferenceError(result?.ok === false ? "当前视图已切换，但偏好未保存。" : "");
				} catch (_error) { setPreferenceError("当前视图已切换，但偏好未保存。"); }
			};
			const selectMode = (next) => { setMode(next); void writePreference({ contentViewMode: next }); };
				const alignProject = async (project, connectMissing) => {
					if (project === void 0) return;
					const attempt = ++alignmentAttempt.current;
					const currentAtStart = alignmentCurrent.current;
					setActiveProjectKey(project.key); setAlignmentPending(true); setAlignmentError("");
					try {
						let targetId = project.representativeId;
						if (targetId === void 0 && connectMissing) {
							const connected = await projectActions.connect(project.workspaceId);
							if (alignmentAttempt.current !== attempt || !Object.is(alignmentCurrent.current, currentAtStart)) return;
						if (connected?.ok !== true) { setAlignmentError(" 无法建立项目会话。"); return; }
						targetId = connected.sessionId;
					}
					const result = projectActions.open(targetId);
					if (alignmentAttempt.current === attempt && result?.ok !== true) setAlignmentError(result?.reason === "service" ? " 会话服务不可用。" : " 代表会话不可用。");
				} catch (_error) {
					if (alignmentAttempt.current === attempt) setAlignmentError(" 对齐意外中断。");
				} finally {
					if (alignmentAttempt.current === attempt) setAlignmentPending(false);
				}
			};
			const detailsSession = useSessions((s) => {
				const current = s.current;
				return current !== void 0 && s.byId[current]?.blank === false ? current : void 0;
			});
			const frameRef = (0, react.useRef)(null);
			const [viewport, setViewport] = (0, react.useState)(() => window.innerWidth);
			const lastSession = (0, react.useRef)(detailsSession);
			(0, react.useLayoutEffect)(() => {
				if (detailsSession === void 0) return;
				if (lastSession.current !== void 0 && lastSession.current !== detailsSession) actions.closeDetails();
				lastSession.current = detailsSession;
			}, [actions, detailsSession]);
			(0, react.useEffect)(() => {
				const el = frameRef.current;
				/* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
				if (el === null) return;
				let raf = null;
				const observer = new ResizeObserver(() => {
					raf ??= requestAnimationFrame(() => {
						raf = null;
						const width = el.getBoundingClientRect().width;
						if (width > 0) setViewport(width);
					});
				});
				observer.observe(el);
				return () => {
					observer.disconnect();
					if (raf !== null) cancelAnimationFrame(raf);
				};
			}, []);
			const narrow = viewport < SIDEBAR_AUTO_COLLAPSE;
			(0, react.useEffect)(() => {
				actions.setNarrow(narrow);
			}, [actions, narrow]);
			const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0;
			const cols = computeColumns(viewport, sidebarCollapsed ? 0 : panels.sidebar === 0 ? 280 : panels.sidebar, detailsSession === void 0 ? 0 : panels.details);
			const colsRef = (0, react.useRef)(cols);
			colsRef.current = cols;
			const sidebarBase = (0, react.useRef)(0);
			const detailsBase = (0, react.useRef)(0);
			const [dragging, setDragging] = (0, react.useState)(false);
			const onDragEnd = (0, react.useCallback)(() => {
				setDragging(false);
			}, []);
			const onSidebarStart = (0, react.useCallback)(() => {
				sidebarBase.current = colsRef.current.sidebar;
				setDragging(true);
			}, []);
			const onDetailsStart = (0, react.useCallback)(() => {
				detailsBase.current = colsRef.current.details;
				setDragging(true);
			}, []);
			const onSidebarDrag = (0, react.useCallback)((dx) => {
				actions.setSidebar(sidebarBase.current + dx);
			}, [actions]);
			const onDetailsDrag = (0, react.useCallback)((dx) => {
				actions.setDetails(detailsBase.current - dx);
			}, [actions]);
			const modeSwitch = (0, react_jsx_runtime.jsxs)("div", { className: "wd10-switch", role: "tablist", "aria-label": "左侧视图", children: [(0, react_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": mode === "sessions", onClick: () => selectMode("sessions"), children: "会话" }), (0, react_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": mode === "content", onClick: () => selectMode("content"), children: "内容" })] });
			if (mode === "content") {
				const left = viewport < 1120 ? 232 : 272;
				const detail = clampWidth(viewport * .31, viewport < 1120 ? 300 : 340, 440);
				const activeProject = projects.find((project) => project.key === activeProjectKey) || projects[0];
				const mismatch = activeProject !== void 0 && activeProject.key !== currentProjectKey;
				const contentSwitch = (0, react_jsx_runtime.jsxs)("div", { className: "wd10-switch wd10-subSwitch", role: "tablist", "aria-label": "内容态左栏", children: [(0, react_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": contentLeftView === "library", onClick: () => setContentLeftView("library"), children: "内容库" }), (0, react_jsx_runtime.jsx)("button", { type: "button", role: "tab", "aria-selected": contentLeftView === "native", onClick: () => setContentLeftView("native"), children: "会话与设置" })] });
				return (0, react_jsx_runtime.jsxs)("div", {
					ref: frameRef,
					className: AppFrame_module_css_default.frame,
					style: { gridTemplateColumns: `${left}px ${detail}px minmax(0, 1fr)` },
					"data-whaledock-layout": "v0.10-p1",
					"data-whaledock-mode": "content",
					"data-details-collapsed": cols.details === 0 || void 0,
					children: [(0, react_jsx_runtime.jsxs)("aside", { className: "wd10-left", children: [modeSwitch, preferenceError && (0, react_jsx_runtime.jsx)("p", { className: "wd10-prefStatus", role: "status", children: preferenceError }), !hintSeen && (0, react_jsx_runtime.jsxs)("div", { className: "wd10-hint", role: "status", children: [(0, react_jsx_runtime.jsx)("span", { children: "这里是内容库，点「会话」回到原生列表" }), (0, react_jsx_runtime.jsx)("button", { type: "button", onClick: () => { setHintSeen(true); void writePreference({ contentViewHintSeen: true }); }, children: "知道了" })] }), contentSwitch, (0, react_jsx_runtime.jsx)("div", { className: "wd10-leftView", hidden: contentLeftView !== "library", children: (0, react_jsx_runtime.jsx)(CreatorSidebar, { projects, activeKey: activeProject?.key, onSelect: (project) => { void alignProject(project, false); } }) }), (0, react_jsx_runtime.jsx)("div", { className: "wd10-nativeSidebar", hidden: contentLeftView !== "native", children: renderSlot("sidebar", { collapsed: sidebarCollapsed, width: left }) })] }), (0, react_jsx_runtime.jsx)(CreatorDetail, { project: activeProject, tab: creatorTab, onTab: setCreatorTab, projectActions, alignment: mismatch ? { currentTitle: currentProject?.title || sessionState.byId[sessionState.current]?.displayTitle || "未选择会话", pending: alignmentPending, error: alignmentError } : null, onAlign: () => { void alignProject(activeProject, true); } }), (0, react_jsx_runtime.jsxs)("section", { className: "wd10-chat", "aria-label": "原生对话", children: [(0, react_jsx_runtime.jsx)("div", { className: "wd10-chatMain", children: renderSlot("conversation", {}) }), (0, react_jsx_runtime.jsx)(DetailsColumn, { className: "wd10-contentDetails", style: { width: cols.details, flexBasis: cols.details }, "aria-hidden": cols.details === 0, children: renderSlot("details", {}) })] }), (0, react_jsx_runtime.jsx)("div", { className: AppFrame_module_css_default.overlayLayer, "data-shell-overlay": true, children: renderSlot("shell.overlay", {}) })]
				});
			}
			return (0, react_jsx_runtime.jsxs)("div", {
				ref: frameRef,
				className: AppFrame_module_css_default.frame,
				style: { gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` },
				"data-whaledock-layout": "v0.10-p1",
				"data-sidebar-collapsed": sidebarCollapsed || void 0,
				"data-details-collapsed": cols.details === 0 || void 0,
				"data-dragging": dragging || void 0,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "wd10-left",
						children: [modeSwitch, preferenceError && (0, react_jsx_runtime.jsx)("p", { className: "wd10-prefStatus", role: "status", children: preferenceError }), renderSlot("sidebar", {
							collapsed: sidebarCollapsed,
							width: cols.sidebar
						})]
					}),
					(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(CenterColumn, { children: renderSlot("conversation", {}) }), (0, react_jsx_runtime.jsx)(DetailsColumn, { children: renderSlot("details", {}) })] }),
					(0, react_jsx_runtime.jsx)("div", {
						className: AppFrame_module_css_default.overlayLayer,
						"data-shell-overlay": true,
						children: renderSlot("shell.overlay", {})
					}),
					!sidebarCollapsed && (0, react_jsx_runtime.jsx)(DragHandle, {
						side: "sidebar",
						left: cols.sidebar,
						onStart: onSidebarStart,
						onDrag: onSidebarDrag,
						onEnd: onDragEnd
					}),
					cols.details > 0 && (0, react_jsx_runtime.jsx)(DragHandle, {
						side: "details",
						left: viewport - cols.details,
						onStart: onDetailsStart,
						onDrag: onDetailsDrag,
						onEnd: onDragEnd
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/stores.js
		/**
		* The root entry's transient layout store: panel geometry as plain widths in
		* px (0 = closed). Module level exports the factory only — a module-level
		* handle would pin the store's identity in the module
		* cache (a de-facto singleton surviving plugin reloads). register() receives
		* the factory (exclusive use: the framework instantiates per entry), AppFrame
		* derives its PropsStore share from the return type, and the service face
		* receives the bound actions through the registration's inject hook.
		*/
		/**
		* Create the layout panel store handle. The preference IS the width, so
		* closing a panel forgets its drag width — reopening restores the contract
		* default. Actions are the complete write set: drag writes clamp
		* into the panel's contract range and never cross the open/closed line;
		* open/close transitions write 0 / the default explicitly. Below the
		* auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
		* flips the narrowExpanded override instead of the preference.
		* @returns the store handle (spec + type + identity + factory in one).
		*/
		function createLayoutStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => ({
					sidebar: 280,
					details: 0,
					narrow: false,
					narrowExpanded: false
				}),
				actions: {
					setSidebar: (d, px) => {
						d.sidebar = clampWidth(px, 264, 420);
					},
					setDetails: (d, px) => {
						d.details = clampWidth(px, 300, 520);
					},
					toggleSidebar: (d) => {
						if (d.narrow) d.narrowExpanded = !d.narrowExpanded;
						else d.sidebar = d.sidebar === 0 ? 280 : 0;
					},
					setNarrow: (d, narrow) => {
						if (d.narrow === narrow) return;
						d.narrow = narrow;
						d.narrowExpanded = false;
					},
					openDetails: (d) => {
						if (d.details === 0) d.details = 360;
					},
					closeDetails: (d) => {
						d.details = 0;
					}
				}
			});
		}
		//#endregion
		//#region lib/types/client/service.js
		/** Cross-plugin panel-action face (ctx.layout). */
		var LayoutController = class {
			#panels;
			/**
			* Adopt the root entry's bound store actions. Called from the root
			* registration's inject hook (a sanctioned assembly side effect), so the
			* face is live from the entry's first render; on entry re-register the
			* fresh actions overwrite the stale set.
			* @param actions - bound actions of the entry's layout store instance.
			*/
			attachPanels(actions) {
				this.#panels = actions;
			}
			/** Toggle the sidebar panel (closed ⟷ contract default width). */
			toggleSidebar() {
				this.#require().toggleSidebar();
			}
			/** Open the details panel (no-op when already open). */
			openDetails() {
				this.#require().openDetails();
			}
			/** Close the details panel. */
			closeDetails() {
				this.#require().closeDetails();
			}
			#require() {
				if (this.#panels === void 0) throw new Error("layout: panel actions not wired (root entry not mounted)");
				return this.#panels;
			}
		};
		//#endregion
		//#region lib/types/client/theme-presenter.js
		/** Body attribute selecting the dark base palette in the token stylesheets. */
		const DARK_ATTRIBUTE = "data-ds-dark-theme";
		/** Applies theme snapshots to the document; one instance per plugin fiber. */
		var ThemePresenter = class {
			/** Token names this presenter wrote in the last apply (its retraction set). */
			appliedTokens = [];
			/** The single metadata node this presenter inserts and removes. */
			themeColorMeta;
			/** Create the presenter-owned metadata node before the first snapshot arrives. */
			constructor() {
				this.themeColorMeta = document.createElement("meta");
				this.themeColorMeta.name = "theme-color";
			}
			/**
			* Project a snapshot onto the document: set root `color-scheme` and the body
			* palette attribute from `active.colorScheme` (never the id — `system` is
			* resolved upstream), then replace the previously applied token variables
			* with `active.tokens`. Browser theme-color metadata follows the computed
			* body background after those writes, so the rendered palette remains the
			* color authority.
			* @param snapshot - resolved theme snapshot from ctx.theme.
			*/
			apply(snapshot) {
				const scheme = snapshot.active.colorScheme;
				document.documentElement.style.colorScheme = scheme;
				const body = document.body;
				if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");
				else body.removeAttribute(DARK_ATTRIBUTE);
				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				for (const [name, value] of Object.entries(snapshot.active.tokens)) {
					body.style.setProperty(name, value);
					this.appliedTokens.push(name);
				}
				this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
				if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
			}
			/** Retract root color-scheme, the palette attribute, token variables, and the owned metadata node. */
			dispose() {
				document.documentElement.style.removeProperty("color-scheme");
				const body = document.body;
				body.removeAttribute(DARK_ATTRIBUTE);
				for (const name of this.appliedTokens) body.style.removeProperty(name);
				this.appliedTokens = [];
				this.themeColorMeta.remove();
			}
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
		const inject = ["slots", "theme"];
		/**
		* Client plugin body: provide ctx.layout, then one register() call — AppFrame
		* into 'root' with the four child-slot declarations, the layout store seat,
		* and the inject hook that hands the store's bound actions to the service.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			const layout = new LayoutController();
			ctx.effect(() => {
				const disposeService = ctx.reflect.provide("layout", layout);
				const disposeRegistration = ctx.slots.register({
					name: "root",
					children: {
						"sidebar": {
							kind: "single",
							scope: "root"
						},
						"conversation": {
							kind: "single",
							scope: "session-maybe"
						},
						"details": {
							kind: "single",
							scope: "session"
						},
						"shell.overlay": {
							kind: "list",
							scope: "root"
						}
					},
					store: createLayoutStore,
					inject: (actions) => {
						layout.attachPanels(actions);
						return { projectActions: {
							get preferences() { return ctx.get("whaledockShellPreferences"); },
							open(sessionId) {
								const sessions = ctx.get("sessions");
								if (sessions === void 0) return { ok: false, code: "session-unavailable", reason: "service" };
								if (sessionId === void 0) return { ok: false, code: "session-unavailable", reason: "target" };
								try { sessions.open(sessionId); return { ok: true, sessionId }; } catch (_error) { return { ok: false, code: "session-unavailable", reason: "target" }; }
							},
							async connect(workspaceId) {
								const workspaces = ctx.get("workspaces");
								if (workspaces === void 0 || workspaceId === void 0) return { ok: false, code: "workspace-unavailable" };
								try { const sessionId = await workspaces.connectWorkspace(workspaceId); return sessionId === void 0 ? { ok: false, code: "workspace-unavailable" } : { ok: true, sessionId }; } catch (_error) { return { ok: false, code: "workspace-unavailable" }; }
							},
							async fillDraft(sessionId, text, workspaceId, signal) {
								const sessions = ctx.get("sessions");
								if (sessions === void 0) return { ok: false, code: "session-unavailable", reason: "service" };
								let currentAtStart;
								try { currentAtStart = sessions.list.getSnapshot().current; } catch (_error) { return { ok: false, code: "session-unavailable", reason: "service" }; }
								const currentUnchanged = () => {
									try { return Object.is(sessions.list.getSnapshot().current, currentAtStart); } catch (_error) { return false; }
								};
								const operationStale = () => signal?.aborted === true || !currentUnchanged();
								if (operationStale()) return { ok: false, code: "operation-stale" };
								let targetId = sessionId;
								if (targetId === void 0 && workspaceId !== void 0) {
									const workspaces = ctx.get("workspaces");
									if (workspaces === void 0) return { ok: false, code: "workspace-unavailable" };
									try { targetId = await workspaces.connectWorkspace(workspaceId); } catch (_error) { return { ok: false, code: "workspace-unavailable" }; }
									if (operationStale()) return { ok: false, code: "operation-stale" };
									if (targetId === void 0) return { ok: false, code: "workspace-unavailable" };
								}
								if (targetId === void 0) return { ok: false, code: "session-unavailable", reason: "target" };
								let input;
								for (let attempt = 0; attempt < 3 && input === void 0; attempt += 1) {
									try {
										const actx = sessions.scope(targetId);
										input = actx === void 0 ? void 0 : ctx.get("conversation")?.input.for(actx);
									} catch (_error) { /* rc.2 binding 契约失守时才走下面的短兜底 */ }
									if (operationStale()) return { ok: false, code: "operation-stale" };
									if (input === void 0 && attempt < 2) {
										await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
										if (operationStale()) return { ok: false, code: "operation-stale" };
									}
								}
								if (input === void 0) return { ok: false, code: "session-unavailable", reason: "input" };
								if (operationStale()) return { ok: false, code: "operation-stale" };
								try {
									if (String(input.state.getSnapshot().draft ?? "") !== "") return { ok: false, code: "draft-not-empty" };
									if (operationStale()) return { ok: false, code: "operation-stale" };
									input.setDraft(text);
								} catch (_error) { return { ok: false, code: "session-unavailable", reason: "input" }; }
								const rollback = () => { try { if (input.state.getSnapshot().draft === text) input.setDraft(""); } catch (_error) { /* 仅回滚本次仍持有的草稿 */ } };
								if (operationStale()) { rollback(); return { ok: false, code: "operation-stale" }; }
								try { sessions.open(targetId); } catch (_error) { rollback(); return { ok: false, code: "session-unavailable", reason: "target" }; }
								return { ok: true };
							}
						} };
					}
				}, AppFrame);
				return () => {
					disposeRegistration();
					disposeService();
				};
			}, "ui-layout: service + root registration");
			ctx.effect(() => {
				const presenter = new ThemePresenter();
				presenter.apply(ctx.theme.getTheme());
				const off = ctx.on("theme/change", (snapshot) => {
					presenter.apply(snapshot);
				});
				return () => {
					off();
					presenter.dispose();
				};
			}, "ui-layout: theme presenter");
		}
		//#endregion
		exports.LayoutController = LayoutController;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
