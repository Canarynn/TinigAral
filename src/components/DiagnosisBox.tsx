// ============================================================
// DINIG — DiagnosisBox.tsx
// Smart Acoustic Diagnosis & Highest-Impact Recommendation Card
// With Collapsible Accordion & Interactive Applied Feedback
// ============================================================

import React, { useMemo, useState } from 'react';
import {
  Lightbulb,
  ArrowRight,
  TrendingUp,
  CheckCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { RoomState } from '../types/room';
import type { AcousticMetrics } from '../engine/acoustics';
import { diagnoseClassroom, type AcousticDiagnosis } from '../engine/diagnosis';

interface DiagnosisBoxProps {
  room: RoomState;
  metrics: AcousticMetrics;
  onApplyFix: (newRoom: RoomState) => void;
}

export const DiagnosisBox: React.FC<DiagnosisBoxProps> = ({ room, metrics, onApplyFix }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  const diagnosis: AcousticDiagnosis = useMemo(
    () => diagnoseClassroom(room, metrics),
    [room, metrics]
  );
  const { headline, primaryIssue, recommendation } = diagnosis;

  const hasActionableFix = recommendation.projectedScoreGain > 0;

  const handleApply = () => {
    onApplyFix(recommendation.applyFix(room));
    setJustApplied(true);
    setTimeout(() => {
      setJustApplied(false);
    }, 2200);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-surface-800/95 p-3.5 backdrop-blur shadow-xl transition-all duration-300">
      {/* ── Diagnosis Header ── */}
      <div className="flex items-center justify-between">
        <div
          className="flex items-center gap-1.5 select-none group"
        >
          <div className="p-1 rounded-md bg-amber-500/20 text-amber-400 group-hover:bg-amber-500/30 transition-colors">
            <Lightbulb size={13} />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
            Acoustic Diagnosis
          </span>
          <button
            type="button"
            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand diagnosis' : 'Collapse diagnosis'}
            className="text-slate-500 hover:text-slate-300 ml-1 p-0.5 rounded transition-colors"
            title={isCollapsed ? 'Expand diagnosis' : 'Collapse diagnosis'}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>

        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-white/5 text-slate-400 border border-white/5">
          DepEd ISO 3382
        </span>
      </div>

      {/* ── Collapsible Body ── */}
      {!isCollapsed && (
        <div id="acoustic-diagnosis-content" className="mt-2.5">
          {/* ── Headline & Primary Cause ── */}
          <div className="mb-3">
            <h4 className="text-xs font-bold text-white leading-snug">{headline}</h4>
            <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">{primaryIssue}</p>
          </div>

          {/* ── Highest-Impact Intervention Recommendation ── */}
          <div className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-accent-400 flex items-center gap-1">
                <Sparkles size={11} />
                High-Impact Intervention
              </span>

              <span
                className={[
                  'text-[9px] font-semibold px-1.5 py-0.5 rounded border',
                  recommendation.costTag === 'Free'
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : recommendation.costTag === 'Low-Cost'
                    ? 'bg-sky-500/20 text-sky-400 border-sky-500/30'
                    : 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                ].join(' ')}
              >
                {recommendation.costTag}
              </span>
            </div>

            <h5 className="text-[11px] font-bold text-slate-100">{recommendation.title}</h5>
            <p className="text-[10px] text-slate-300 mt-0.5 leading-snug">{recommendation.description}</p>

            {/* Projected Gain Badge & Action */}
            <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-accent-500/20">
              <div className="flex items-center gap-2">
                {hasActionableFix ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                      <TrendingUp size={12} />
                      +{recommendation.projectedScoreGain}% Score
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({recommendation.projectedRT60Delta > 0 ? '+' : ''}
                      {recommendation.projectedRT60Delta}s RT₆₀)
                    </span>
                  </>
                ) : (
                  <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle size={11} /> Target Met
                  </span>
                )}
              </div>

              {hasActionableFix && (
                <button
                  onClick={handleApply}
                  disabled={justApplied}
                  className={[
                    'flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-all shadow-glow-teal active:scale-95',
                    justApplied
                      ? 'bg-emerald-500 text-surface-950 font-black cursor-default'
                      : 'bg-accent-500 text-surface-950 hover:bg-accent-400',
                  ].join(' ')}
                >
                  {justApplied ? (
                    <>
                      <CheckCircle size={11} />
                      <span>✓ Applied!</span>
                    </>
                  ) : (
                    <>
                      <span>Apply Fix</span>
                      <ArrowRight size={11} />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiagnosisBox;
