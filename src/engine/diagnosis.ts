// ============================================================
// TinigAral — Smart Acoustic Diagnosis & Recommendation Engine
// Analyzes room state and projects highest-impact interventions
// ============================================================

import type { RoomState } from '../types/room';
import { computeAcoustics, type AcousticMetrics } from './acoustics';

export interface AcousticRecommendation {
  title: string;
  category: 'treatment' | 'layout' | 'behavior';
  costTag: 'Free' | 'Low-Cost' | 'Moderate';
  description: string;
  projectedScoreGain: number; // e.g. +18 (%)
  projectedRT60Delta: number; // e.g. -0.45 (s)
  applyFix: (room: RoomState) => RoomState;
}

export interface AcousticDiagnosis {
  headline: string;
  primaryIssue: string;
  details: string[];
  recommendation: AcousticRecommendation;
}

export function diagnoseClassroom(room: RoomState, currentMetrics: AcousticMetrics): AcousticDiagnosis {
  const { teacher, activeListener, wallSegments, noiseSources, deskClusters } = room;
  const currentScore = currentMetrics.intelligibilityScore;
  const currentRT60 = currentMetrics.rt60;

  // Geometry facts
  const distTeacher = Math.hypot(teacher.x - activeListener.x, teacher.y - activeListener.y);
  const openWindows = wallSegments.filter((w) => w.material === 'open_window');
  const bareWalls = wallSegments.filter((w) => w.material === 'concrete');
  const occupiedChairs = deskClusters.filter((dc) => dc.occupied).reduce((sum, dc) => sum + dc.seats, 0);

  // Identify primary culprits
  const issues: string[] = [];

  if (currentRT60 > 1.0) {
    issues.push(`Excessive reverberation (${currentRT60.toFixed(2)}s RT₆₀) causes syllabic smearing.`);
  } else if (currentRT60 > 0.65) {
    issues.push(`Moderate reverberation (${currentRT60.toFixed(2)}s RT₆₀) slightly degrades speech transients.`);
  }

  if (currentMetrics.noiseLevel > 52) {
    issues.push(`High ambient noise infiltration (${currentMetrics.noiseLevel.toFixed(1)} dBA) from external sources.`);
  }

  if (currentMetrics.snr < 10) {
    issues.push(`Low Signal-to-Noise Ratio (${currentMetrics.snr >= 0 ? '+' : ''}${currentMetrics.snr.toFixed(1)} dB) below WHO classroom threshold (+15 dB).`);
  }

  if (distTeacher > 4.5) {
    issues.push(`Long acoustic distance (${distTeacher.toFixed(1)}m) reduces direct speech pressure level.`);
  }

  if (openWindows.length > 0 && noiseSources.length > 0) {
    issues.push(`${openWindows.length} unshielded open window aperture(s) allow roadside noise intrusion.`);
  }

  // Determine concise headline
  let headline = 'Acoustic Environment Within DepEd Standards';
  let primaryIssue = 'Well-balanced absorption and noise shielding.';

  if (currentMetrics.intelligibilityStatus === 'Critical') {
    if (currentRT60 > 1.2 && currentMetrics.noiseLevel > 52) {
      headline = 'Echo Chamber & Noise Inundation';
      primaryIssue = `Excessive ${currentRT60.toFixed(2)}s concrete reverberation coupled with unshielded roadside noise.`;
    } else if (currentRT60 > 1.2) {
      headline = 'Severe Reverberant Masking';
      primaryIssue = `Bare concrete walls produce ${currentRT60.toFixed(2)}s echo, causing words to overlap.`;
    } else {
      headline = 'Noise Masking Threshold Exceeded';
      primaryIssue = `Infiltrated noise (${currentMetrics.noiseLevel.toFixed(1)} dBA) overpowers direct teacher speech.`;
    }
  } else if (currentMetrics.intelligibilityStatus === 'Strained') {
    if (currentMetrics.noiseLevel > 48) {
      headline = 'Compromised Signal-to-Noise Ratio';
      primaryIssue = `Background noise reduces speech contrast, forcing vocal strain.`;
    } else {
      headline = 'Moderate Reverberation Penalty';
      primaryIssue = `RT₆₀ of ${currentRT60.toFixed(2)}s exceeds the recommended 0.6s threshold for learning spaces.`;
    }
  } else {
    headline = 'Optimal Speech Intelligibility';
    primaryIssue = `Speech is clearly distinct with sufficient signal margin (+${currentMetrics.snr.toFixed(1)} dB SNR).`;
  }

  // ── Candidate Interventions Evaluation ─────────────────────
  // We simulate prospective fixes and choose the one that yields the highest score gain.
  const candidates: AcousticRecommendation[] = [];

  // Fix 1: Add heavy curtains to all open windows (Low cost)
  if (openWindows.length > 0) {
    const fixRoom: RoomState = {
      ...room,
      wallSegments: wallSegments.map((w) =>
        w.material === 'open_window' ? { ...w, material: 'curtained_window' } : w
      ),
    };
    const projected = computeAcoustics(fixRoom);
    const gain = Math.round(projected.intelligibilityScore - currentScore);
    const rtDelta = Number((projected.rt60 - currentRT60).toFixed(2));
    if (gain > 0) {
      candidates.push({
        title: 'Install Heavy Pleated Curtains',
        category: 'treatment',
        costTag: 'Low-Cost',
        description: `Cover ${openWindows.length} window aperture(s) with thick acoustic fabric to block +7 dB external noise and boost absorption.`,
        projectedScoreGain: gain,
        projectedRT60Delta: rtDelta,
        applyFix: (r) => ({
          ...r,
          wallSegments: r.wallSegments.map((w) =>
            w.material === 'open_window' ? { ...w, material: 'curtained_window' } : w
          ),
        }),
      });
    }
  }

  // Fix 2: Mount acoustic absorption panels on bare concrete walls
  if (bareWalls.length > 0) {
    // Treat back wall (north) or front wall
    const fixRoom: RoomState = {
      ...room,
      wallSegments: wallSegments.map((w) =>
        w.id === 'wall-north' || w.id === 'wall-south' ? { ...w, material: 'acoustic_panel' } : w
      ),
    };
    const projected = computeAcoustics(fixRoom);
    const gain = Math.round(projected.intelligibilityScore - currentScore);
    const rtDelta = Number((projected.rt60 - currentRT60).toFixed(2));
    if (gain > 0) {
      candidates.push({
        title: 'Install Perimeter Acoustic Panels',
        category: 'treatment',
        costTag: 'Moderate',
        description: `Mount 50mm fiberglass/fabric panels on concrete perimeter to slash reverberation time toward the 0.55s target.`,
        projectedScoreGain: gain,
        projectedRT60Delta: rtDelta,
        applyFix: (r) => ({
          ...r,
          wallSegments: r.wallSegments.map((w) =>
            w.id === 'wall-north' || w.id === 'wall-south' ? { ...w, material: 'acoustic_panel' } : w
          ),
        }),
      });
    }
  }

  // Fix 3: Reposition listener closer to front/center (Free)
  if (distTeacher > 3.5) {
    const fixRoom: RoomState = {
      ...room,
      activeListener: { x: teacher.x, y: teacher.y + 2.5 },
    };
    const projected = computeAcoustics(fixRoom);
    const gain = Math.round(projected.intelligibilityScore - currentScore);
    const rtDelta = Number((projected.rt60 - currentRT60).toFixed(2));
    if (gain > 0) {
      candidates.push({
        title: 'Relocate Listener to Front 3rd Row',
        category: 'layout',
        costTag: 'Free',
        description: `Move listener from ${distTeacher.toFixed(1)}m to 2.5m directly in front of the teacher to maximize direct speech level.`,
        projectedScoreGain: gain,
        projectedRT60Delta: rtDelta,
        applyFix: (r) => ({
          ...r,
          activeListener: { x: r.teacher.x, y: Math.min(r.dimensions.depth - 0.5, r.teacher.y + 2.5) },
        }),
      });
    }
  }

  // Fix 4: Occupy empty student desks if empty
  if (occupiedChairs === 0 && deskClusters.length > 0) {
    const fixRoom: RoomState = {
      ...room,
      deskClusters: deskClusters.map((dc) => ({ ...dc, occupied: true })),
    };
    const projected = computeAcoustics(fixRoom);
    const gain = Math.round(projected.intelligibilityScore - currentScore);
    const rtDelta = Number((projected.rt60 - currentRT60).toFixed(2));
    if (gain > 0) {
      candidates.push({
        title: 'Fill Student Seating Capacity',
        category: 'behavior',
        costTag: 'Free',
        description: `Full student presence adds 0.45 Sabins per student, naturally taming flutter echoes and RT₆₀.`,
        projectedScoreGain: gain,
        projectedRT60Delta: rtDelta,
        applyFix: (r) => ({
          ...r,
          deskClusters: r.deskClusters.map((dc) => ({ ...dc, occupied: true })),
        }),
      });
    }
  }

  // Sort candidates by projected score gain descending
  candidates.sort((a, b) => b.projectedScoreGain - a.projectedScoreGain);

  const defaultRecommendation: AcousticRecommendation = {
    title: 'Room Acoustically Optimized',
    category: 'treatment',
    costTag: 'Free',
    description: 'Current configuration satisfies DepEd NSRP and WHO classroom acoustic guidelines.',
    projectedScoreGain: 0,
    projectedRT60Delta: 0,
    applyFix: (r) => r,
  };

  const topRecommendation = candidates.length > 0 && candidates[0].projectedScoreGain > 1
    ? candidates[0]
    : defaultRecommendation;

  return {
    headline,
    primaryIssue,
    details: issues.length > 0 ? issues : ['Reverberation and signal-to-noise margins are optimal.'],
    recommendation: topRecommendation,
  };
}
