import React from 'react';
import {
  User, Database, Puzzle, Brain, Settings, ArrowDown, MoveDown, Layers,
  Wrench, Activity, Save, Play, Workflow, ArrowUpCircle, ChevronRight, Network
} from 'lucide-react';
import { buildHarnessArchitecture } from '../lib/harnessArchitecture.js';

export default function HarnessVisualizer({ harness, features = {}, skills = [], tools = [] }) {
  const architecture = buildHarnessArchitecture(features, { tools, skills });
  const {
    knowledge,
    hasTools,
    hasTeams,
    memoryEnabled: isMemoryEnabled,
    skillsEnabled: isSkillsEnabled,
    compactionEnabled: isCompactionEnabled,
    taskOrchestrationEnabled: isTaskOrchestrationEnabled,
  } = architecture;
  const hasFeedbackLoop = hasTools || isTaskOrchestrationEnabled || hasTeams || knowledge.showKnowledgeTools;

  // Safely parse model string
  let modelStr = 'Default Model Routing';
  if (harness?.model) {
    if (typeof harness.model === 'string') {
      modelStr = harness.model;
    } else if (typeof harness.model === 'object') {
      modelStr = harness.model.name || harness.model.model || harness.model.modelId || 'Default Model';
    }
  }

  // Hardcoded minimalist color palette for elegant, project-agnostic rendering
  const colors = {
    bgCanvas: '#f8fafc', // Light canvas background
    bgBase: '#ffffff',
    bgElevated: '#fafafa',
    bgMuted: '#f1f5f9',
    border: '#e2e8f0',
    borderHover: '#cbd5e1',
    textPrimary: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    accent: '#3b82f6', // Clean blue for the active feedback loop
    arrow: '#94a3b8' // Darker gray for flowchart arrows to ensure contrast
  };

  const Arrow = () => (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0', color: colors.arrow }}>
      <MoveDown size={20} strokeWidth={1.5} />
    </div>
  );

  const SectionNode = ({ title, icon: Icon, children }) => (
    <div style={{
      background: colors.bgBase,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      padding: '16px',
      width: '100%',
      boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
      position: 'relative',
      zIndex: 2
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px',
        color: colors.textPrimary, fontWeight: '600', fontSize: '13px'
      }}>
        {Icon && <Icon size={16} />}
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {children}
      </div>
    </div>
  );

  const ItemCard = ({ label, description, icon: Icon, active = true }) => (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '10px',
      padding: '10px 12px',
      background: active ? colors.bgBase : colors.bgMuted,
      border: `1px solid ${active ? colors.borderHover : 'transparent'}`,
      borderRadius: '6px',
      opacity: active ? 1 : 0.6,
    }}>
      <div style={{ color: active ? colors.textPrimary : colors.textMuted, marginTop: '2px' }}>
        {Icon && <Icon size={14} />}
      </div>
      <div>
        <div style={{ fontSize: '12px', fontWeight: '500', color: active ? colors.textPrimary : colors.textSecondary }}>
          {label}
        </div>
        {description && (
          <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '2px' }}>
            {description}
          </div>
        )}
      </div>
    </div>
  );

  const KnowledgeRuntimeNode = () => {
    if (!knowledge.showManifest && !knowledge.showQueryPreparation) return null;

    return (
      <div style={{
        border: `1px solid ${colors.borderHover}`,
        borderLeft: `3px solid ${colors.accent}`,
        borderRadius: '6px',
        padding: '10px',
        background: colors.bgElevated,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: colors.textSecondary }}>
          <Database size={14} />
          <span style={{ fontSize: '12px', fontWeight: '600' }}>Knowledge Runtime</span>
          <span style={{
            marginLeft: 'auto',
            padding: '2px 6px',
            borderRadius: '4px',
            background: colors.bgMuted,
            color: colors.textMuted,
            fontSize: '10px',
            fontFamily: 'monospace',
          }}>
            {knowledge.strategy}
          </span>
        </div>
        {knowledge.showManifest && (
          <ItemCard
            icon={Database}
            label="Mounted Knowledge Manifest"
            description="Stable mounted-base inventory pinned into the system context."
          />
        )}
        {knowledge.showQueryPreparation && (
          <ItemCard
            icon={Activity}
            label="Query Preparation · Raw User Query"
            description="Current retrieval query uses the latest user message. Rewrite strategies plug in here."
          />
        )}
        {knowledge.showRetrieval && (
          <ItemCard
            icon={Database}
            label="Knowledge Retrieval"
            description="Runs vector, keyword, or hybrid search using each knowledge base's settings."
          />
        )}
        {knowledge.showRerank && (
          <ItemCard
            icon={Layers}
            label="Rerank · Per Knowledge Base"
            description="Reorders retrieved candidates only when the mounted base enables reranking."
          />
        )}
        {knowledge.showInjectionGate && (
          <ItemCard
            icon={ArrowDown}
            label="Retrieved Knowledge Injection Gate"
            description="Only matching sources are injected into the current user turn."
          />
        )}
      </div>
    );
  };

  return (
    <div style={{
      padding: '40px 60px', // Extra padding to accommodate the left loop arrow
      maxWidth: '720px',
      margin: '0 auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      position: 'relative',
      background: colors.bgCanvas,
      borderRadius: '16px',
      border: `1px solid ${colors.border}`,
      boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.01)'
    }}>
      {/* 1. User Input */}
      <div style={{
        background: colors.bgBase, border: `1px solid ${colors.border}`, borderRadius: '24px',
        padding: '8px 24px', margin: '0 auto', width: 'fit-content',
        display: 'flex', alignItems: 'center', gap: '8px',
        fontSize: '13px', fontWeight: '500', color: colors.textPrimary, boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
        position: 'relative', zIndex: 2
      }}>
        <User size={14} />
        User Input / Trigger
      </div>
      <Arrow />

      {/* LOOP WRAPPER: Contains everything from Prompt Assembly down to Execution Phase */}
      <div style={{ position: 'relative' }}>
        
        {/* Feedback Loop Line (drawn absolutely within this wrapper) */}
        {hasFeedbackLoop && (
          <div style={{
            position: 'absolute',
            left: '-48px', // Pushed further left for more breathing room
            top: '24px', 
            bottom: '40px', 
            width: '48px', // Match the left offset
            borderLeft: `2px solid ${colors.accent}`,
            borderTop: `2px solid ${colors.accent}`,
            borderBottom: `2px solid ${colors.accent}`,
            borderTopLeftRadius: '12px',
            borderBottomLeftRadius: '12px',
            zIndex: 3, // Changed from 1 to 3 to render the arrow head OVER the SectionNode border
            opacity: 0.8
          }}>
            {/* The right-pointing arrow head at the top right of the line */}
            <div style={{
              position: 'absolute',
              top: '-9px',
              right: '-8px',
              color: colors.accent,
              background: colors.bgCanvas, 
              borderRadius: '50%',
              padding: '2px'
            }}>
              <ChevronRight size={14} strokeWidth={3} />
            </div>
            
            {/* The loop label */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '-20px',
              transform: 'translateY(-50%) rotate(-90deg)',
              fontSize: '10px',
              fontWeight: '600',
              color: colors.accent,
              whiteSpace: 'nowrap',
              letterSpacing: '0.05em',
              textTransform: 'uppercase'
            }}>
              Feedback Loop
            </div>
          </div>
        )}

        {/* 2. Pre-LLM Pipeline */}
        <SectionNode title="Pre-LLM Pipeline" icon={Puzzle}>
          <ItemCard
            icon={Settings}
            label="Base Guidance"
            description="AGENTS.md & System Prompt Rules"
          />
          {isSkillsEnabled && (
            <ItemCard
              icon={Activity}
              label={`Dynamic Skills (${skills?.length || 0} Active)`}
              description="Injects selected skill rules into prompt."
            />
          )}
          {isMemoryEnabled && (
            <ItemCard
              icon={Save}
              label="Episodic Memory Injection"
              description="Retrieves relevant past interactions and facts."
            />
          )}
          <KnowledgeRuntimeNode />
        </SectionNode>
        <Arrow />

        {/* 4. Payload Optimization */}
        {isCompactionEnabled && (
          <>
            <SectionNode title="Payload Optimization" icon={Layers}>
              <ItemCard
                icon={Layers}
                label="Context Compaction"
                description="Compresses historical messages to prevent token limits."
              />
            </SectionNode>
            <Arrow />
          </>
        )}

        {/* 5. LLM Gateway */}
        <div style={{
          background: colors.bgBase, border: `2px solid ${colors.borderHover}`, borderRadius: '8px',
          padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.05)', position: 'relative', zIndex: 2
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <Brain size={24} color={colors.textPrimary} />
            <div style={{ fontWeight: '600', fontSize: '14px', color: colors.textPrimary }}>LLM Gateway</div>
            <div style={{ fontSize: '11px', color: colors.textMuted, fontFamily: 'monospace', background: colors.bgMuted, padding: '2px 6px', borderRadius: '4px' }}>
              {modelStr}
            </div>
          </div>
          
          {/* Explicit LLM Reasoning Phase */}
          <div style={{
            marginTop: '8px',
            borderTop: `1px dashed ${colors.border}`,
            paddingTop: '12px'
          }}>
             <ItemCard
                icon={Network}
                label="LLM Reasoning (Chain of Thought)"
                description="The model deliberates and streams internal thoughts before outputting the final action or response."
                active={true}
              />
          </div>
        </div>
        <Arrow />

        {/* 5. Execution Phase */}
        {hasFeedbackLoop && (
          <>
            <SectionNode title="Execution Phase (Post-LLM)" icon={Play}>
              {hasTools && (
                <ItemCard
                  icon={Wrench}
                  label={`Tool Dispatcher (${tools.length} Tools)`}
                  description="Executes API integrations and local functions."
                />
              )}
              {knowledge.showKnowledgeTools && (
                <ItemCard
                  icon={Database}
                  label="Knowledge Query Tools"
                  description="The model can list mounted bases or issue its own knowledge query."
                />
              )}
              {isTaskOrchestrationEnabled && (
                <ItemCard
                  icon={Workflow}
                  label={`Task Orchestrator (${features.task_orchestration.mode})`}
                  description="Manages multi-step plans and TODO state loops."
                />
              )}
              {hasTeams && (
                <ItemCard
                  icon={User}
                  label="Sub-Agent Teams"
                  description="Delegates tasks to specialized parallel agents."
                />
              )}
            </SectionNode>
            {/* The Arrow pointing down from Execution Phase to Post-Processing is drawn below */}
          </>
        )}
      </div> 
      {/* END LOOP WRAPPER */}

      {hasFeedbackLoop && <Arrow />}

      {/* 7. Post Processing */}
      {isMemoryEnabled && (
        <>
          <SectionNode title="Post-Processing" icon={Save}>
            <ItemCard
              icon={Brain}
              label="Memory Consolidation"
              description="Extracts and persists facts from the LLM's response."
            />
          </SectionNode>
          <Arrow />
        </>
      )}

      {/* 8. Final Output */}
      <div style={{
        background: colors.bgBase, border: `1px solid ${colors.border}`, borderRadius: '24px',
        padding: '8px 24px', margin: '0 auto', width: 'fit-content',
        display: 'flex', alignItems: 'center', gap: '8px',
        fontSize: '13px', fontWeight: '500', color: colors.textPrimary, boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
        position: 'relative', zIndex: 2
      }}>
        <Activity size={14} />
        Final Output
      </div>

    </div>
  );
}
