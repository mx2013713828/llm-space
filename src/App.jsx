import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import './index.css';
import './App.css';
import { TrajectoryPage } from './pages/TrajectoryPage';
import { PromptLabPage } from './pages/PromptLabPage';
import { apiFetch } from './lib/apiClient';

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
];

function AppContent() {
  const { harnessId, tab } = useParams();
  const navigate = useNavigate();

  const activeTab = tab || 'trajectory';
  const activeHarnessId = harnessId || '';

  const [harnessFiles, setHarnessFiles] = useState([]);
  const [harness, setHarness] = useState(null);
  const [sessions, setSessions] = useState({});

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

  // 新建 Harness 表单状态
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newError, setNewError] = useState('');

  // 右键菜单状态
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, harnessId }

  const loadHarnessList = () => {
    apiFetch('/api/harnesses')
      .then(r => r.json())
      .then(setHarnessFiles)
      .catch(err => console.error("加载文件列表失败:", err));
  };

  const handleCreateHarness = async (e) => {
    e.preventDefault();
    setNewError('');
    if (!newName.trim()) {
      setNewError('Please enter a name');
      return;
    }
    try {
      const res = await apiFetch('/api/harnesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() })
      });
      const data = await res.json();
      if (!res.ok) {
        setNewError(data.error || 'Failed to create');
        return;
      }
      await loadHarnessList();
      navigate(`/${data.harness.id}/${activeTab}`);
      setNewName('');
      setNewDesc('');
      setShowNewForm(false);
    } catch (err) {
      setNewError('Network error: ' + err.message);
    }
  };

  const handleDeleteHarness = async (id) => {
    if (!confirm(`Are you sure you want to delete Harness "${id}"? This action cannot be undone.`)) return;
    try {
      const res = await apiFetch(`/api/harnesses/${id}`, { method: 'DELETE' });
      if (!res.ok) { alert('Failed to delete'); return; }
      await loadHarnessList();
      if (activeHarnessId === id) {
        if (harnessFiles.length > 1) {
          const nextHarness = harnessFiles.find(f => f.id !== id);
          navigate(`/${nextHarness.id}/${activeTab}`);
        } else {
          navigate('/');
        }
      }
    } catch (err) { alert('Network error: ' + err.message); }
  };

  const handleCopyHarness = async (id) => {
    try {
      const res = await apiFetch(`/api/harnesses/${id}/copy`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Failed to copy'); return; }
      await loadHarnessList();
      navigate(`/${data.harness.id}/${activeTab}`);
    } catch (err) { alert('Network error: ' + err.message); }
    setCtxMenu(null);
  };

  // 加载列表
  useEffect(() => {
    apiFetch('/api/harnesses')
      .then(res => res.json())
      .then(data => {
        setHarnessFiles(data);
      })
      .catch(err => console.error("Failed to load harness list:", err));
  }, []);

  // 当列表加载完毕且 URL 中缺失 harnessId 时，自动重定向到第一个有效 Harness
  useEffect(() => {
    if (harnessFiles.length > 0 && !harnessId) {
      navigate(`/${harnessFiles[0].id}/${activeTab}`, { replace: true });
    }
  }, [harnessFiles, harnessId, activeTab, navigate]);

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
              onClick={() => navigate(`/${activeHarnessId}/${tab.key}`)}
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
      <div className="app-body">
        {/* 侧边栏：Harness 文件列表 */}
        <aside className="sidebar">
          <div className="sidebar-header">
            Harness Explorer
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="icon-btn"
                onClick={loadHarnessList}
                title="Refresh List"
              >
                ↻
              </button>
              <button
                style={{ padding: '2px 6px', fontSize: 12, borderRadius: 4, background: 'var(--green)', color: '#fff', border: '1px solid var(--green)', cursor: 'pointer' }}
                onClick={() => setShowNewForm(v => !v)}
                title="Create Harness"
              >
                +
              </button>
            </div>
          </div>
          <div className="sidebar-list">
            {harnessFiles.map(file => (
              <div
                key={file.id}
                id={`harness-${file.id}`}
                className={`sidebar-item ${activeHarnessId === file.id ? 'active' : ''}`}
                onClick={() => navigate(`/${file.id}/${activeTab}`)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, harnessId: file.id });
                }}
              >
                <span className="sidebar-item-icon">📄</span>
                <div className="sidebar-item-info">
                  <div className="sidebar-item-name">{file.name}</div>
                  <div className="sidebar-item-desc">{file.description}</div>
                </div>
                <button
                  className="sidebar-item-delete"
                  onClick={(e) => { e.stopPropagation(); handleDeleteHarness(file.id); }}
                  title="Delete"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>

          {/* 新建 Harness 表单 */}
          {showNewForm && (
            <form
              onSubmit={handleCreateHarness}
              style={{
                padding: '10px 12px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Create New Harness</span>
                <button
                  type="button"
                  onClick={() => { setShowNewForm(false); setNewError(''); }}
                  style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>
              <input
                type="text"
                placeholder="Name (e.g., 03-example)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={{
                  padding: '4px 8px', fontSize: 12, borderRadius: 4,
                  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
                }}
                autoFocus
              />
              <input
                type="text"
                placeholder="Description (Optional)"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                style={{
                  padding: '4px 8px', fontSize: 12, borderRadius: 4,
                  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
                }}
              />
              {newError && (
                <span style={{ fontSize: 11, color: 'var(--red)' }}>{newError}</span>
              )}
              <button
                type="submit"
                style={{
                  padding: '4px 0', fontSize: 12, borderRadius: 4,
                  background: 'var(--green)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600,
                }}
              >
                Create
              </button>
            </form>
          )}

          {/* 侧边栏底部信息 */}
          <div style={{
            padding: '10px 12px',
            borderTop: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}>
            <div style={{ marginBottom: 6, fontWeight: 600, color: 'var(--text-secondary)' }}>
              📖 User Guide
            </div>
            <div>Select different harness configurations to observe agent behavior, and modify configurations in the lab in real-time.</div>
          </div>
        </aside>

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
                apiFetch(`/api/harnesses/${updatedHarness.id}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(updatedHarness)
                }).then(() => setHarness(updatedHarness));
              }}
            />
          )}
        </main>
      </div>

      {/* 右键菜单 */}
      {ctxMenu && (
        <>
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div
            style={{
              position: 'fixed',
              left: ctxMenu.x,
              top: ctxMenu.y,
              zIndex: 100,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              padding: '4px 0',
              minWidth: 140,
            }}
          >
            <button
              onClick={() => handleCopyHarness(ctxMenu.harnessId)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '6px 12px', fontSize: 12, background: 'none', border: 'none',
                color: 'var(--text)', cursor: 'pointer',
              }}
              onMouseEnter={e => e.target.style.background = 'var(--surface-hover)'}
              onMouseLeave={e => e.target.style.background = 'none'}
            >
              📋 Copy Harness
            </button>
          </div>
        </>
      )}
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
