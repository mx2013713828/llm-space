import { useState, useEffect } from 'react';
import './index.css';
import './App.css';
import { TrajectoryPage } from './pages/TrajectoryPage';
import { PromptLabPage } from './pages/PromptLabPage';

/* ===== 导航配置 ===== */
const TABS = [
  {
    key: 'trajectory',
    label: '运行轨迹',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  {
    key: 'prompt-lab',
    label: '配置工作台',
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

const FILE_ICONS = {
  basic: '💬',
  advanced: '🔬',
};

export default function App() {
  const [activeTab, setActiveTab] = useState('trajectory');
  const [activeHarnessId, setActiveHarnessId] = useState('');
  
  const [harnessFiles, setHarnessFiles] = useState([]);
  const [harness, setHarness] = useState(null);
  const [sessions, setSessions] = useState({});

  // 加载列表
  useEffect(() => {
    fetch('http://localhost:3001/api/harnesses')
      .then(res => res.json())
      .then(data => {
        setHarnessFiles(data);
        if (data.length > 0 && !activeHarnessId) {
          setActiveHarnessId(data[0].id);
        }
      })
      .catch(err => console.error("加载文件列表失败:", err));
  }, []);

  // 加载特定文件
  useEffect(() => {
    if (!activeHarnessId) return;
    setHarness(null); // Clear harness first to avoid stale state initialization in child components
    fetch(`http://localhost:3001/api/harnesses/${activeHarnessId}`)
      .then(res => res.json())
      .then(data => setHarness(data))
      .catch(err => console.error("加载 Harness 详情失败:", err));
  }, [activeHarnessId]);

  const currentSession = sessions[activeHarnessId] || null;

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
              onClick={() => setActiveTab(tab.key)}
              id={`tab-${tab.key}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* 右侧信息 */}
        <div className="topbar-right">
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {harness?.model?.name || '加载中...'}
          </span>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--green)',
            boxShadow: '0 0 6px var(--green)',
            animation: 'pulse-glow 2s ease-in-out infinite',
          }} />
          <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>本地运行</span>
        </div>
      </header>

      {/* ===== 主体 ===== */}
      <div className="app-body">
        {/* 侧边栏：Harness 文件列表 */}
        <aside className="sidebar">
          <div className="sidebar-header">
            Harness 资源管理器
            <button 
              style={{ padding: '2px 6px', fontSize: 12, borderRadius: 4, background: 'var(--surface-hover)', border: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => {
                fetch('http://localhost:3001/api/harnesses').then(r=>r.json()).then(setHarnessFiles);
              }}
            >
              ↻
            </button>
          </div>
          <div className="sidebar-list">
            {harnessFiles.map(file => (
              <div
                key={file.id}
                id={`harness-${file.id}`}
                className={`sidebar-item ${activeHarnessId === file.id ? 'active' : ''}`}
                onClick={() => setActiveHarnessId(file.id)}
              >
                <span className="sidebar-item-icon">
                  {FILE_ICONS[file.category] || '📄'}
                </span>
                <div className="sidebar-item-info">
                  <div className="sidebar-item-name">{file.name}</div>
                  <div className="sidebar-item-desc">{file.description}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 侧边栏底部信息 */}
          <div style={{
            padding: '10px 12px',
            borderTop: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}>
            <div style={{ marginBottom: 6, fontWeight: 600, color: 'var(--text-secondary)' }}>
              📖 学习指南
            </div>
            <div>选择不同的 harness 配置以观察 agent 行为，并在工作台中实时修改配置。</div>
          </div>
        </aside>

        {/* 主内容区 */}
        <main className="main-content">
          {activeTab === 'trajectory' && harness && (
            <TrajectoryPage 
              key={activeHarnessId} 
              harness={harness} 
              savedSession={currentSession}
              onSessionUpdate={(messages, todos) => {
                setSessions(prev => ({
                  ...prev,
                  [activeHarnessId]: { messages, todos }
                }));
              }}
              onSessionReset={() => {
                setSessions(prev => ({
                  ...prev,
                  [activeHarnessId]: null
                }));
              }}
            />
          )}
          {activeTab === 'prompt-lab' && harness && (
            <PromptLabPage 
              key={activeHarnessId} 
              harness={harness} 
              onSave={(updatedHarness) => {
                fetch(`http://localhost:3001/api/harnesses/${updatedHarness.id}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(updatedHarness)
                }).then(() => setHarness(updatedHarness));
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
