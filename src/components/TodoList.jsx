/**
 * TODO 任务列表组件
 * 展示任务的完成状态、优先级、进度
 */
export function TodoList({ todos }) {
  if (!todos || todos.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <div className="empty-state-title">暂无 TODO 任务</div>
        <div className="empty-state-desc">当 agent 使用 write_todos 工具时，任务将显示在这里</div>
      </div>
    );
  }

  const completed = todos.filter(t => t.status === 'completed').length;
  const inProgress = todos.filter(t => t.status === 'in_progress').length;
  const total = todos.length;
  const progress = Math.round((completed / total) * 100);

  const STATUS_CONFIG = {
    completed:   { label: '完成', color: 'var(--green)',  bgColor: 'var(--green-dim)',  icon: '✓' },
    in_progress: { label: '执行中', color: 'var(--blue)', bgColor: 'var(--blue-dim)', icon: '▶' },
    pending:     { label: '待执行', color: 'var(--text-muted)', bgColor: 'var(--bg-elevated)', icon: '○' },
    failed:      { label: '失败', color: 'var(--red)',   bgColor: 'var(--red-dim)',   icon: '✗' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 进度概览 */}
      <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>任务进度</span>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--blue)' }}>
            {completed}/{total}
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--green)' }}>✓ {completed} 完成</span>
          {inProgress > 0 && <span style={{ color: 'var(--blue)' }}>▶ {inProgress} 执行中</span>}
          <span>{total - completed - inProgress} 待执行</span>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="todo-list">
        {todos.map((todo, idx) => {
          const statusCfg = STATUS_CONFIG[todo.status] || STATUS_CONFIG.pending;
          return (
            <div
              key={todo.id || idx}
              className={`todo-item ${todo.status}`}
              style={{ animationDelay: `${idx * 0.05}s` }}
            >
              <div
                className={`todo-check ${todo.status}`}
                style={{ color: statusCfg.color }}
              >
                {todo.status === 'completed' && '✓'}
                {todo.status === 'in_progress' && (
                  <span style={{ fontSize: 8, animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>◐</span>
                )}
                {todo.status === 'failed' && '✗'}
              </div>

              <div className="todo-content">
                {todo.content}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                {todo.priority && (
                  <span className={`todo-priority priority-${todo.priority}`}>
                    {todo.priority === 'high' ? '高' : todo.priority === 'medium' ? '中' : '低'}
                  </span>
                )}
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 99,
                  background: statusCfg.bgColor, color: statusCfg.color, fontWeight: 600
                }}>
                  {statusCfg.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
