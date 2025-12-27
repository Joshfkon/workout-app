/**
 * Learn Page Content
 *
 * Educational content about RPE/RIR calibration, safety tiers,
 * and progressive overload concepts.
 */

// ============================================
// TYPES
// ============================================

export interface LearnSection {
  heading: string;
  content: string;
}

export interface LearnTopic {
  id: string;
  title: string;
  description: string;
  sections: LearnSection[];
  relatedTopics?: string[];
}

// ============================================
// RPE CALIBRATION CONTENT
// ============================================

export const RPE_CALIBRATION_CONTENT: LearnTopic = {
  id: 'rpe-calibration',
  title: 'Understanding RPE & RIR',
  description: 'Learn how to accurately gauge your effort and calibrate your perception of proximity to failure.',
  sections: [
    {
      heading: 'What is RIR?',
      content: `RIR (Reps in Reserve) is how many more reps you could have done with good form. It's more concrete than "rate your effort 1-10."

- **RIR 0** = Failure (couldn't do another rep)
- **RIR 1** = Could do 1 more rep
- **RIR 2** = Could do 2 more reps
- **RIR 3+** = Had gas left in the tank

Most hypertrophy training happens at RIR 1-3. Going to failure (RIR 0) has diminishing returns and increases recovery demands.`,
    },
    {
      heading: 'The Calibration Problem',
      content: `Research shows most lifters underestimate proximity to failure by 2-4 reps. What feels like "2 reps left" is often 4-5 reps from true failure.

This matters because:
- Training at "RIR 2" when you're actually at RIR 5 = suboptimal stimulus
- Your weights never increase because you're not actually pushing hard enough
- You plateau and wonder why you're not progressing

The only way to calibrate is to occasionally experience true failure.`,
    },
    {
      heading: 'How HyperTracker Calibrates You',
      content: `We prescribe AMRAP (As Many Reps As Possible) sets on safe exercises - machines, cables, isolation work.

When you do an AMRAP, we compare your actual max reps to what your recent RIR reports predicted. If you've been reporting "RIR 3" at 8 reps, you implied you could do 11 reps. If the AMRAP shows you can do 14, you've been sandbagging.

We show you this feedback so you can recalibrate your internal sense of effort.`,
    },
    {
      heading: 'Safety Tiers',
      content: `Not all exercises are safe to fail on:

**Safe to Fail** - Machines, cables, most isolation
Push to true failure. The machine catches the weight. This is your calibration data.

**Moderate Risk** - Dumbbells, lunges, supported rows
Push hard but keep 1 rep in reserve. We'll test limits at mesocycle end.

**Protect** - Barbell squat, bench, deadlift, overhead press
Stay at 2+ RIR always. A torn pec or herniated disc isn't worth that last rep. The injury risk of failure far outweighs any benefit.`,
    },
    {
      heading: 'What "Hard" Should Feel Like',
      content: `RIR 2-3 should feel like work:
- Your last 2-3 reps are noticeably slower than your first
- You're bracing harder, grip is tightening
- You might make a face or grunt
- You could do more, but it would be a genuine fight

If every rep feels the same and you're breathing normally at the end, you're probably at RIR 4-5, not RIR 2.`,
    },
    {
      heading: 'Signs You\'re Sandbagging',
      content: `- Weights haven't increased in 6+ weeks but you report RIR 2-3
- You consistently hit the top of your rep range
- Your AMRAP results are 3+ reps higher than predicted
- You never feel particularly tired after training

The fix isn't complicated: push harder on safe exercises, and trust the AMRAP feedback.`,
    },
  ],
  relatedTopics: ['safety-tiers', 'progressive-overload'],
};

// ============================================
// SAFETY TIERS CONTENT
// ============================================

export const SAFETY_TIERS_CONTENT: LearnTopic = {
  id: 'safety-tiers',
  title: 'Exercise Safety Tiers',
  description: 'Understanding which exercises are safe to push to failure and which require caution.',
  sections: [
    {
      heading: 'Why Safety Tiers Matter',
      content: `Going to failure can be a powerful training tool - but only when it's safe. On a leg press, failing just means the weight stops. On a heavy squat without safeties, failing can mean serious injury.

We categorize exercises into three tiers based on the risk of injury at failure. This determines:
- Whether we prescribe AMRAP sets
- The minimum RIR floor we enforce
- How we calculate your progression`,
    },
    {
      heading: 'Safe to Fail (Green)',
      content: `**Machines, cables, most isolation exercises**

Examples: Leg press, leg extension, cable flyes, lat pulldown, any machine

These exercises have built-in safety:
- The machine catches the weight if you fail
- No balance or stability demands
- Low injury risk even at complete failure

We use these for calibration - AMRAP sets every 2 weeks to measure your true capacity.`,
    },
    {
      heading: 'Moderate Risk (Yellow)',
      content: `**Dumbbells, lunges, some free weight work**

Examples: Dumbbell bench, lunges, Romanian deadlifts, step-ups

These exercises can be failed relatively safely:
- Dumbbells can be dropped
- Single leg work allows you to catch yourself
- Lower absolute loads than barbells

We allow AMRAP sets at mesocycle end or after deloads, but keep RIR at 1+ normally.`,
    },
    {
      heading: 'Protect (Red)',
      content: `**Heavy barbell compounds**

Examples: Barbell bench press, back squat, deadlift, overhead press

Failure on these exercises carries real injury risk:
- Barbell can't be dropped safely without proper equipment
- High spinal loads under fatigue
- Breakdown in form can cause acute injuries

**Never go below RIR 2 on these exercises.** Use sub-maximal estimation and calibrate from your safe exercises.`,
    },
    {
      heading: 'Adjusting for Equipment',
      content: `Your gym's equipment matters:

**With power rack and safety pins:**
Squats and bench become safer - but still not as safe as machines

**Training alone without spotters:**
Be extra conservative on all barbell work

**Using Smith machine:**
The guided path makes these exercises closer to "safe to fail"

When in doubt, treat an exercise as one tier more dangerous than it appears.`,
    },
  ],
  relatedTopics: ['rpe-calibration', 'injury-prevention'],
};

// ============================================
// PROGRESSIVE OVERLOAD CONTENT
// ============================================

export const PROGRESSIVE_OVERLOAD_CONTENT: LearnTopic = {
  id: 'progressive-overload',
  title: 'Progressive Overload',
  description: 'The fundamental principle of strength and hypertrophy - doing more over time.',
  sections: [
    {
      heading: 'What is Progressive Overload?',
      content: `Progressive overload is the gradual increase of stress placed on your muscles. Your body adapts to training by getting stronger and bigger - but only if you consistently challenge it with more than it's used to.

Without progressive overload, your body has no reason to adapt. You'll maintain, but not improve.`,
    },
    {
      heading: 'The Progression Hierarchy',
      content: `We progress through these methods in order:

**1. Load Progression** (Primary)
Add weight when you can. This is the most effective driver of strength.

**2. Rep Progression**
Add reps at the same weight before adding more weight.

**3. Set Progression**
Add sets within a mesocycle to accumulate more volume.

**4. Technique Progression**
Improve movement quality - better mind-muscle connection, fuller range of motion.`,
    },
    {
      heading: 'When to Add Weight',
      content: `The app tracks your performance and recommends weight increases when you:

- Hit the top of your rep range for 2-3 sessions
- Report moderate RIR (2-3) consistently
- Maintain good form throughout

Don't rush it. Premature weight increases lead to grinding, form breakdown, and plateaus.`,
    },
    {
      heading: 'Managing Plateaus',
      content: `If weights haven't increased in 6+ weeks:

**Check your RIR calibration** - Are you actually pushing hard enough?

**Check your recovery** - Sleep, nutrition, and stress all affect performance

**Try a deload** - Sometimes you need to step back to leap forward

**Swap the exercise** - New stimulus can break through sticking points

The app detects stagnation and suggests interventions.`,
    },
    {
      heading: 'Rate of Progression',
      content: `Realistic expectations by experience level:

**Beginner (0-1 year)**: Add weight almost every session
**Intermediate (1-3 years)**: Add weight every few weeks
**Advanced (3+ years)**: Monthly or longer between increases

Small, consistent progress beats sporadic big jumps. A 2.5kg increase per month is 30kg per year.`,
    },
  ],
  relatedTopics: ['rpe-calibration', 'deload-timing'],
};

// ============================================
// DELOAD CONTENT
// ============================================

export const DELOAD_CONTENT: LearnTopic = {
  id: 'deload-timing',
  title: 'When to Deload',
  description: 'Strategic recovery weeks that allow your body to supercompensate and come back stronger.',
  sections: [
    {
      heading: 'What is a Deload?',
      content: `A deload is a planned reduction in training stress - typically reducing volume by 50% and intensity by 30-40%.

During normal training, you accumulate fatigue faster than you recover from it. Deloads give your body a chance to fully recover and adapt to the training you've done.

Think of it as two steps forward, one step back - the step back enables larger future steps.`,
    },
    {
      heading: 'Proactive vs Reactive Deloads',
      content: `**Proactive (Scheduled)**
Every 4-6 weeks, regardless of how you feel. Built into your mesocycle as the final week.

**Reactive (As Needed)**
When warning signs appear: declining performance, persistent fatigue, loss of motivation, joint aches.

Most people benefit from proactive deloads because they don't recognize the signs of accumulated fatigue until it's too late.`,
    },
    {
      heading: 'Signs You Need a Deload',
      content: `- Performance declining for 2+ sessions
- Weights that used to feel light now feel heavy
- Sleep quality dropping
- General lack of motivation to train
- Joint aches or persistent soreness
- Getting sick more often

If you're seeing these signs regularly, you might need more frequent deloads or less volume overall.`,
    },
    {
      heading: 'How to Deload',
      content: `**Volume deload**: Keep intensity, halve the sets
Best for: Hypertrophy-focused training, accumulated fatigue

**Intensity deload**: Keep volume, reduce weight by 30-40%
Best for: Strength-focused training, joint stress

**Full deload**: Reduce both volume and intensity
Best for: Major accumulated fatigue, after peaking, when very beaten up

Active rest (light movement, no structured training) is also an option but usually not necessary.`,
    },
  ],
  relatedTopics: ['progressive-overload', 'fatigue-management'],
};

// ============================================
// ALL LEARN CONTENT
// ============================================

export const LEARN_CONTENT: Record<string, LearnTopic> = {
  'rpe-calibration': RPE_CALIBRATION_CONTENT,
  'safety-tiers': SAFETY_TIERS_CONTENT,
  'progressive-overload': PROGRESSIVE_OVERLOAD_CONTENT,
  'deload-timing': DELOAD_CONTENT,
};

export const LEARN_TOPICS_ORDER = [
  'rpe-calibration',
  'safety-tiers',
  'progressive-overload',
  'deload-timing',
];

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a learn topic by ID
 */
export function getLearnTopic(id: string): LearnTopic | null {
  return LEARN_CONTENT[id] || null;
}

/**
 * Get all learn topics in display order
 */
export function getAllLearnTopics(): LearnTopic[] {
  return LEARN_TOPICS_ORDER.map(id => LEARN_CONTENT[id]).filter(Boolean);
}

/**
 * Get related topics for a topic
 */
export function getRelatedTopics(topicId: string): LearnTopic[] {
  const topic = LEARN_CONTENT[topicId];
  if (!topic?.relatedTopics) return [];

  return topic.relatedTopics
    .map(id => LEARN_CONTENT[id])
    .filter(Boolean);
}

/**
 * Search learn content
 */
export function searchLearnContent(query: string): Array<{
  topic: LearnTopic;
  section: LearnSection;
  match: string;
}> {
  const results: Array<{
    topic: LearnTopic;
    section: LearnSection;
    match: string;
  }> = [];

  const lowerQuery = query.toLowerCase();

  for (const topic of Object.values(LEARN_CONTENT)) {
    for (const section of topic.sections) {
      if (
        section.heading.toLowerCase().includes(lowerQuery) ||
        section.content.toLowerCase().includes(lowerQuery)
      ) {
        // Extract a snippet around the match
        const contentLower = section.content.toLowerCase();
        const matchIndex = contentLower.indexOf(lowerQuery);
        const snippetStart = Math.max(0, matchIndex - 50);
        const snippetEnd = Math.min(section.content.length, matchIndex + query.length + 50);
        const match = '...' + section.content.slice(snippetStart, snippetEnd) + '...';

        results.push({ topic, section, match });
      }
    }
  }

  return results;
}
