/*
 * SmartMess Demand Prediction Engine (adaptive baseline)
 *
 * Add this file to the same folder as index.html and include it AFTER the
 * existing inline application script:
 *   <script src="smartmess-prediction.js"></script>
 *
 * This is a transparent statistical baseline, not a trained ML model.
 * It learns a rough historical attendance proxy from food consumed
 * (prepared kg - wasted kg) / kg per student. Replace this with a trained
 * model when you have enough clean, labelled data.
 */
(function () {
  'use strict';

  const KG_PER_STUDENT = 0.5;
  const MAX_HISTORY_RECORDS = 30;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getHistoryEstimate(entries, mealType) {
    const relevant = (Array.isArray(entries) ? entries : [])
      .filter(entry =>
        entry &&
        entry.mealType === mealType &&
        Number.isFinite(Number(entry.prepared)) &&
        Number.isFinite(Number(entry.wasted)) &&
        Number(entry.prepared) > 0 &&
        Number(entry.wasted) >= 0 &&
        Number(entry.wasted) <= Number(entry.prepared)
      )
      .slice(-MAX_HISTORY_RECORDS);

    if (!relevant.length) return { attendance: null, count: 0 };

    // Estimate diners from food consumed. This is only a proxy because
    // portion sizes and dishes differ; staff should calibrate KG_PER_STUDENT.
    const estimates = relevant.map(entry =>
      (Number(entry.prepared) - Number(entry.wasted)) / KG_PER_STUDENT
    );

    // Median is less sensitive to unusual days than a simple average.
    estimates.sort((a, b) => a - b);
    const middle = Math.floor(estimates.length / 2);
    const median = estimates.length % 2
      ? estimates[middle]
      : (estimates[middle - 1] + estimates[middle]) / 2;

    return { attendance: median, count: relevant.length };
  }

  function improvedDemandPrediction() {
    // These variables are defined by the existing index.html application.
    const votes = typeof votingData !== 'undefined' ? votingData : {};
    const config = typeof settings !== 'undefined' ? settings : {};
    const entries = typeof staffEntries !== 'undefined' ? staffEntries : [];

    const capacity = Math.max(1, Number(config.hostelStrength) || 500);
    const confirmedEating = clamp(Number(votes.eating) || 0, 0, capacity);
    const totalVotes = Math.max(0, Number(votes.total) || 0);
    const responseRate = clamp(totalVotes / capacity, 0, 1);
    const mealType = typeof getCurrentMealType === 'function'
      ? getCurrentMealType()
      : 'Lunch';

    const history = getHistoryEstimate(entries, mealType);
    let predictedAttendance;
    let explanation;

    if (history.attendance !== null) {
      // Higher response rates make today's votes more reliable.
      const voteWeight = clamp(0.55 + responseRate * 0.30, 0.55, 0.85);
      predictedAttendance = Math.round(
        confirmedEating * voteWeight + history.attendance * (1 - voteWeight)
      );
      explanation = `Today's confirmations weighted with ${history.count} historical ${mealType.toLowerCase()} record(s).`;
    } else {
      // Without historical records, do not pretend there is historical data.
      // Use votes plus a conservative allowance for non-voters.
      const nonVoterAllowance = Math.max(0, capacity - totalVotes) * 0.15;
      predictedAttendance = Math.round(confirmedEating + nonVoterAllowance);
      explanation = 'Based on current confirmations and a conservative allowance for non-voters; no matching history yet.';
    }

    predictedAttendance = clamp(predictedAttendance, 0, capacity);
    const quantity = (predictedAttendance * KG_PER_STUDENT).toFixed(1);

    // Confidence is a heuristic indicator, not a calibrated probability.
    const historyBonus = Math.min(20, history.count * 2);
    const confidence = clamp(
      Math.round(35 + responseRate * 45 + historyBonus),
      35,
      95
    );

    return {
      attendance: predictedAttendance,
      quantity,
      confidence,
      mealType,
      historyRecords: history.count,
      responseRate: Math.round(responseRate * 100),
      explanation,
      model: history.count ? 'Adaptive historical baseline' : 'Vote-based baseline'
    };
  }

  // Replaces the original rule-based function after index.html has loaded.
  // The dashboard already calls calculateDemandPrediction().
  if (typeof calculateDemandPrediction === 'function') {
    calculateDemandPrediction = improvedDemandPrediction;
  } else {
    window.calculateDemandPrediction = improvedDemandPrediction;
  }

  // Expose details for future UI integration / testing.
  window.SmartMessPrediction = {
    predict: improvedDemandPrediction,
    kgPerStudent: KG_PER_STUDENT,
    version: '1.0.0'
  };
})();
