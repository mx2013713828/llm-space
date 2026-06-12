/**
 * TODO 任务列表组件
 * 展示任务的完成状态、优先级、进度、依赖拓扑 (DAG) 以及认领 Owner 状态
 */
export function TodoList({ todos }) {
  if (!todos || todos.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <div className="empty-state-title">暂无任务</div>
        <div className="empty-state-desc">当使用 create_task 工具时，任务 DAG 看板将显示在这里</div>
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
    aborted:     { label: '已撤销', color: 'var(--red)',   bgColor: 'var(--red-dim)',   icon: '✗' }
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
          
          // 获取当前任务的所有依赖项状态
          const dependencyNames = (todo.blockedBy || []).map(depId => {
            const match = todos.find(t => t.id === depId);
            return {
              id: depId,
              subject: match ? match.subject : depId,
              isCompleted: match ? match.status === 'completed' : false
            };
          });

          return (
            <div
              key={todo.id || idx}
              className={`todo-item ${todo.status}`}
              style={{ animationDelay: `${idx * 0.05}s`, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div
                  className={`todo-check ${todo.status}`}
                  style={{ color: statusCfg.color, marginTop: 2 }}
                >
                  {todo.status === 'completed' && '✓'}
                  {todo.status === 'in_progress' && (
                    <span style={{ fontSize: 8, animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>◐</span>
                  )}
                  {['failed', 'aborted'].includes(todo.status) && '✗'}
                  {todo.status === 'pending' && '○'}
                </div>

                <div className="todo-content" style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>
                  {todo.id && todo.id.startsWith('task_') && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                      {todo.id}
                    </div>
                  )}
                  {todo.subject || todo.content}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 99,
                    background: statusCfg.bgColor, color: statusCfg.color, fontWeight: 600
                  }}>
                    {statusCfg.label}
                  </span>
                  {todo.owner && (
                    <span style={{ fontSize: 9, color: 'var(--blue)', background: 'var(--blue-dim)', padding: '1px 4px', borderRadius: 2 }}>
                      👤 {todo.owner}
                    </span>
                  )}
                </div>
              </div>

              {/* 依赖链可视化渲染 */}
              {dependencyNames.length > 0 && (
                <div style={{
                  marginLeft: 22, padding: '4px 8px', borderRadius: 4,
                  background: 'var(--bg-elevated)', border: '1px dashed var(--border)',
                  fontSize: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center'
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>🔒 依赖于:</span>
                  {dependencyNames.map(dep => (
                    <span
                      key={dep.id}
                      style={{
                        padding: '1px 4px', borderRadius: 2,
                        background: dep.isCompleted ? 'var(--green-dim)' : 'var(--border)',
                        color: dep.isCompleted ? 'var(--green)' : 'var(--text-secondary)',
                        textDecoration: dep.isCompleted ? 'line-through' : 'none'
                      }}
                      title={dep.id}
                    >
                      {dep.isCompleted ? '✓' : '🔒'} {dep.subject}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
