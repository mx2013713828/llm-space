import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { FolderTree } from 'lucide-react';
import './index.css';
import './App.css';
import { TrajectoryPage } from './pages/TrajectoryPage';
import { PromptLabPage } from './pages/PromptLabPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { McpPage } from './pages/McpPage';
import { HarnessExplorer } from './components/HarnessExplorer';
import { ResizableWorkbenchPanel } from './components/ResizableWorkbenchPanel';
import { WorkbenchLayoutContext } from './components/WorkbenchLayoutContext';
import { apiFetch } from './lib/apiClient';
import {
  getWorkbenchStorage,
  loadWorkbenchPanelState,
  saveWorkbenchPanelState,
} from './lib/workbenchPanelState';

const EXPLORER_STORAGE_KEY = 'llm-space.workbench.harness-explorer.v1';
const EXPLORER_DEFAULTS = {
  width: 272,
  minWidth: 216,
  maxWidth: 420,
  collapsed: false,
};

/* ===== 导航配置 ===== */
const TABS = [
  {
    key: 'trajectory',
    label: 'Trajectory',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    key: 'prompt-lab',
    label: 'Prompt Lab',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  },
  {
    key: 'knowledge',
    label: 'Knowledge',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M4 4v15.5A2.5 2.5 0 0 1 6.5 22H20V6a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 6.5"/>
        <path d="M8 9h8M8 13h5"/>
      </svg>
    ),
  },
  {
    key: 'mcp',
    label: 'MCP',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 6h8M8 12h8M8 18h8"/>
        <path d="M4 6h.01M4 12h.01M4 18h.01"/>
        <path d="M20 6h.01M20 12h.01M20 18h.01"/>
      </svg>
    ),
  },
];

const TOP_LEVEL_TAB_KEYS = new Set(TABS.map(tab => tab.key));

function AppContent() {
  const { harnessId, tab } = useParams();
  const navigate = useNavigate();

  const routeStartsWithTab = TOP_LEVEL_TAB_KEYS.has(harnessId || '');
  const activeTab = routeStartsWithTab ? harnessId : (tab || 'trajectory');
  const activeHarnessId = routeStartsWithTab ? '' : (harnessId || '');

  const [harnessFiles, setHarnessFiles] = useState([]);
  const [harness, setHarness] = useState(null);
  const [sessions, setSessions] = useState({});
  const [explorerPanel, updateExplorerPanel] = useState(() => (
    loadWorkbenchPanelState(getWorkbenchStorage(), EXPLORER_STORAGE_KEY, EXPLORER_DEFAULTS)
  ));

  const commitExplorerPanel = useCallback((nextPanel) => {
    const persistedPanel = saveWorkbenchPanelState(
      getWorkbenchStorage(),
      EXPLORER_STORAGE_KEY,
      nextPanel,
      EXPLORER_DEFAULTS,
    );
    updateExplorerPanel(persistedPanel);
  }, []);
  const workbenchLayout = useMemo(() => ({
    explorerPanel,
    updateExplorerPanel,
    commitExplorerPanel,
  }), [explorerPanel, commitExplorerPanel]);

  const syncTimeoutRef = useRef(null);

  const saveSessionToBackend = (harnessId, messages, todos, backgroundTasks) => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      apiFetch(`/api/sessions/${harnessId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, todos, backgroundTasks })
      }).catch(err => console.error("Sync Session failed:", err));
    }, 1000);
  };

  const loadHarnessList = useCallback(async () => {
    try {
      const response = await apiFetch('/api/harnesses');
      if (!response.ok) throw new Error('Failed to load Harnesses');
      const files = await response.json();
      setHarnessFiles(files);
      return files;
    } catch (err) {
      console.error('Failed to load Harness list:', err);
      return null;
    }
  }, []);

  const readMutationResponse = async (response, fallback) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || fallback };
    return { ok: true, ...data };
  };

  const handleCreateHarness = async ({ name, description }) => {
    try {
      const response = await apiFetch('/api/harnesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const result = await readMutationResponse(response, 'Failed to create Harness');
      if (!result.ok) return result;
      await loadHarnessList();
      navigate(`/${result.harness.id}/${activeTab}`);
      return result;
    } catch (err) {
      return { ok: false, error: `Network error: ${err.message}` };
    }
  };

  const handleEditHarness = async ({ id, name, description }) => {
    try {
      const response = await apiFetch(`/api/harnesses/${id}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const result = await readMutationResponse(response, 'Failed to update Harness');
      if (!result.ok) return result;
      await loadHarnessList();
      if (activeHarnessId === id) {
        setHarness((current) => current ? { ...current, name, description } : current);
      }
      return result;
    } catch (err) {
      return { ok: false, error: `Network error: ${err.message}` };
    }
  };

  const handleDuplicateHarness = async ({ id, name, description }) => {
    try {
      const response = await apiFetch(`/api/harnesses/${id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const result = await readMutationResponse(response, 'Failed to duplicate Harness');
      if (!result.ok) return result;
      await loadHarnessList();
      navigate(`/${result.harness.id}/${activeTab}`);
      return result;
    } catch (err) {
      return { ok: false, error: `Network error: ${err.message}` };
    }
  };

  const handleDeleteHarness = async ({ id }) => {
    try {
      const response = await apiFetch(`/api/harnesses/${id}`, { method: 'DELETE' });
      const result = await readMutationResponse(response, 'Failed to delete Harness');
      if (!result.ok) return result;
      const files = await loadHarnessList();
      if (activeHarnessId === id) {
        const nextHarness = files?.find((item) => item.id !== id);
        navigate(nextHarness ? `/${nextHarness.id}/${activeTab}` : '/');
      }
      return result;
    } catch (err) {
      return { ok: false, error: `Network error: ${err.message}` };
    }
  };

  // 加载列表
  useEffect(() => {
    loadHarnessList();
  }, [loadHarnessList]);

  // 当列表加载完毕且 URL 中缺失 harnessId 时，自动重定向到第一个有效 Harness
  useEffect(() => {
    if (harnessFiles.length > 0 && !activeHarnessId && !['knowledge', 'mcp'].includes(activeTab)) {
      navigate(`/${harnessFiles[0].id}/${activeTab}`, { replace: true });
    }
  }, [harnessFiles, activeHarnessId, activeTab, navigate]);

  // 加载特定文件及常驻 Session
  useEffect(() => {
    if (!activeHarnessId) return;
    setHarness(null); // Clear harness first to avoid stale state initialization in child components
    
    Promise.all([
      apiFetch(`/api/harnesses/${activeHarnessId}`).then(res => {
        if (!res.ok) throw new Error('Harness not found');
        return res.json();
      }),
      apiFetch(`/api/sessions/${activeHarnessId}`).then(res => {
        if (!res.ok) return null;
        return res.json();
      })
    ])
    .then(([harnessData, sessionData]) => {
      setHarness(harnessData);
      if (sessionData) {
        setSessions(prev => ({
          ...prev,
          [activeHarnessId]: sessionData
        }));
      } else {
        setSessions(prev => ({
          ...prev,
          [activeHarnessId]: null
        }));
      }
    })
    .catch(err => {
      console.error("Failed to load Harness details or Session:", err);
      apiFetch('/api/harnesses')
        .then(res => res.json())
        .then(files => {
          if (files.length > 0) {
            navigate(`/${files[0].id}/${activeTab}`, { replace: true });
          }
        })
        .catch(console.error);
    });
  }, [activeHarnessId, navigate]);

  const currentSession = sessions[activeHarnessId] || null;

  // Stable callback refs — prevents TrajectoryPage's internal effects from re-firing
  // just because App.jsx re-renders due to sessions/harness state updates
  const handleSessionUpdate = useCallback((messages, todos, backgroundTasks) => {
    setSessions(prev => ({
      ...prev,
      [activeHarnessId]: {
        ...prev[activeHarnessId],
        messages,
        todos,
        backgroundTasks,
      }
    }));
    saveSessionToBackend(activeHarnessId, messages, todos, backgroundTasks);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHarnessId]);

  const handleSessionReset = useCallback(() => {
    setSessions(prev => ({
      ...prev,
      [activeHarnessId]: null
    }));
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    apiFetch(`/api/sessions/${activeHarnessId}`, {
      method: 'DELETE'
    }).catch(err => console.error("Failed to clear backend Session:", err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHarnessId]);

  const handleHarnessUpdate = useCallback((updatedHarness) => {
    setHarness(updatedHarness);
  }, []);

  return (
    <div id="app" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', height: '100%' }}>
      {/* ===== 顶部导航 ===== */}
      <header className="topbar">
        {/* Logo */}
        <div className="topbar-logo">
          <div className="topbar-logo-icon">🚀</div>
          <span className="topbar-logo-name gradient-text">LLM Space</span>
        </div>

        {/* 分隔线 */}
        <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 12px' }} />

        {/* 主 Tab 导航 */}
        <div className="topbar-tabs">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`topbar-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => navigate(activeHarnessId ? `/${activeHarnessId}/${tab.key}` : `/${tab.key}`)}
              id={`tab-${tab.key}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* 右侧信息 */}
        <div className="topbar-right">
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--green)',
            boxShadow: '0 0 6px var(--green)',
            animation: 'pulse-glow 2s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>Running Locally</span>
        </div>
      </header>

      {/* ===== 主体 ===== */}
      <WorkbenchLayoutContext.Provider value={workbenchLayout}>
        <div className="app-body">
          <ResizableWorkbenchPanel
            id="harness-explorer-panel"
            label="Harness Explorer"
            icon={<FolderTree size={16} />}
            panel={explorerPanel}
            minWidth={EXPLORER_DEFAULTS.minWidth}
            maxWidth={EXPLORER_DEFAULTS.maxWidth}
            onPanelChange={updateExplorerPanel}
            onPanelCommit={commitExplorerPanel}
          >
            <HarnessExplorer
              harnesses={harnessFiles}
              activeHarnessId={activeHarnessId}
              onSelect={(id) => navigate(`/${id}/${activeTab}`)}
              onRefresh={loadHarnessList}
              onCreate={handleCreateHarness}
              onEdit={handleEditHarness}
              onDuplicate={handleDuplicateHarness}
              onDelete={handleDeleteHarness}
            />
          </ResizableWorkbenchPanel>

          {/* 主内容区 */}
          <main className="main-content">
            {activeTab === 'trajectory' && harness && (
              <TrajectoryPage
                key={activeHarnessId}
                harness={harness}
                savedSession={currentSession}
                onSessionUpdate={handleSessionUpdate}
                onSessionReset={handleSessionReset}
                onHarnessUpdate={handleHarnessUpdate}
              />
            )}
            {activeTab === 'prompt-lab' && harness && (
              <PromptLabPage
                key={activeHarnessId}
                harness={harness}
                onSave={(updatedHarness) => {
                  return apiFetch(`/api/harnesses/${updatedHarness.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedHarness)
                  }).then(() => setHarness(updatedHarness));
                }}
              />
            )}
            {activeTab === 'knowledge' && (
              <KnowledgePage
                harness={harness}
                onSave={(updatedHarness) => {
                  return apiFetch(`/api/harnesses/${updatedHarness.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedHarness)
                  }).then(() => setHarness(updatedHarness));
                }}
              />
            )}
            {activeTab === 'mcp' && (
              <McpPage harness={harness} />
            )}
          </main>
        </div>
      </WorkbenchLayoutContext.Provider>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/:harnessId?/:tab?" element={<AppContent />} />
    </Routes>
  );
}
