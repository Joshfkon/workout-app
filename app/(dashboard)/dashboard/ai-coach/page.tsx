'use client';

import { useState, useEffect, useRef } from 'react';
import { Button, Card, CardContent } from '@/components/ui';
import { sendCoachingMessage, getCoachingConversations, getCoachingContext } from '@/lib/actions/coaching';
import type { CoachingMessage, CoachingContext } from '@/types/coaching';
import { useSubscription } from '@/hooks/useSubscription';
import { UpgradePrompt } from '@/components/subscription';

export default function AICoachPage() {
  const { tier, canAccess } = useSubscription();
  const [messages, setMessages] = useState<CoachingMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [context, setContext] = useState<CoachingContext | null>(null);
  const [showContext, setShowContext] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check if user has access to AI coaching feature
  const hasAccess = canAccess('ai-coaching');

  // Load coaching context on mount
  useEffect(() => {
    if (hasAccess) {
      loadContext();
    }
  }, [hasAccess]);

  const loadContext = async () => {
    try {
      const ctx = await getCoachingContext();
      setContext(ctx);
    } catch (error) {
      console.error('Failed to load coaching context:', error);
    }
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: CoachingMessage = {
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    };

    // Add user message to UI immediately
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Send message to AI coach
      const response = await sendCoachingMessage(input, conversationId);

      // Add AI response to messages
      const assistantMessage: CoachingMessage = {
        role: 'assistant',
        content: response.message,
        timestamp: response.timestamp,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setConversationId(response.conversationId);
    } catch (error) {
      console.error('Failed to send message:', error);

      // Show error message with details
      const errorDetails = error instanceof Error ? error.message : 'Unknown error';
      const errorMessage: CoachingMessage = {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${errorDetails}\n\nPlease check:\n1. Database migrations are run\n2. ANTHROPIC_API_KEY is set in environment\n3. Browser console for more details`,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const startNewConversation = () => {
    setMessages([]);
    setConversationId(undefined);
  };

  if (!hasAccess) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">AI Coach</h1>
          <p className="text-surface-400">
            Get personalized training advice based on your actual data
          </p>
        </div>

        <UpgradePrompt
          feature="ai-coaching"
          description="Get personalized training advice from an AI coach that analyzes your actual workout data, body composition, and training phase."
          requiredTier="elite"
        />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] max-w-5xl mx-auto p-6 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">AI Coach</h1>
          <p className="text-surface-400">
            Ask me anything about your training, nutrition, or progress
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowContext(!showContext)}
          >
            {showContext ? 'Hide' : 'Show'} Context
          </Button>
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={startNewConversation}>
              New Chat
            </Button>
          )}
        </div>
      </div>

      {/* Context Panel */}
      {showContext && context && (
        <Card className="mb-4 bg-surface-800 border-surface-700">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold text-white mb-2">Your Data Context</h3>
            <div className="text-xs text-surface-300 space-y-1">
              <p>
                <strong>User:</strong> {context.user.name} ({context.user.age}yo,{' '}
                {context.user.sex}, {context.user.height}cm, {context.user.trainingAge}y training age)
              </p>
              {context.phase && (
                <p>
                  <strong>Phase:</strong> {context.phase.type} - Week {context.phase.weekNumber}{' '}
                  ({context.phase.startWeight}kg → {context.phase.targetWeight}kg)
                </p>
              )}
              <p>
                <strong>Current Stats:</strong> {context.currentStats.weight}kg
                {context.currentStats.weightTrend && ` (${context.currentStats.weightTrend})`}
                {context.currentStats.bodyFat && `, ${context.currentStats.bodyFat.toFixed(1)}% BF`}
              </p>
              {context.training.currentBlock && (
                <p>
                  <strong>Training:</strong> {context.training.currentBlock} - Week{' '}
                  {context.training.weekInBlock} ({context.training.daysPerWeek} days/week)
                </p>
              )}
              <p>
                <strong>Recent Lifts:</strong> {context.training.recentLifts.length} tracked
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary-500/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-primary-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-white mb-2">
                Welcome to Your AI Coach
              </h3>
              <p className="text-surface-400 max-w-md">
                I have access to your training data, body composition, and current program.
                Ask me anything about your progress, form, programming, or recovery.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 max-w-2xl mt-8">
              <button
                onClick={() => setInput("How's my progress looking?")}
                className="p-4 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg text-left transition-colors"
              >
                <p className="text-sm font-medium text-white">How&apos;s my progress?</p>
                <p className="text-xs text-surface-400 mt-1">
                  Get a summary of your recent performance
                </p>
              </button>

              <button
                onClick={() =>
                  setInput('Should I deload this week or keep pushing?')
                }
                className="p-4 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg text-left transition-colors"
              >
                <p className="text-sm font-medium text-white">Deload or push?</p>
                <p className="text-xs text-surface-400 mt-1">
                  Get advice on when to take a deload week
                </p>
              </button>

              <button
                onClick={() => setInput('What exercises should I focus on for hypertrophy?')}
                className="p-4 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg text-left transition-colors"
              >
                <p className="text-sm font-medium text-white">Exercise selection</p>
                <p className="text-xs text-surface-400 mt-1">
                  Get recommendations on exercise choices
                </p>
              </button>

              <button
                onClick={() =>
                  setInput('How should I adjust my training for my current phase?')
                }
                className="p-4 bg-surface-800 hover:bg-surface-700 border border-surface-700 rounded-lg text-left transition-colors"
              >
                <p className="text-sm font-medium text-white">Phase adjustments</p>
                <p className="text-xs text-surface-400 mt-1">
                  Optimize training for cut/bulk/maintenance
                </p>
              </button>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${
                    msg.role === 'user'
                      ? 'bg-primary-600 text-white'
                      : 'bg-surface-800 text-surface-100 border border-surface-700'
                  }`}
                >
                  <div className="prose prose-sm prose-invert max-w-none">
                    {msg.content.split('\n').map((line, i) => (
                      <p key={i} className="mb-2 last:mb-0">
                        {line}
                      </p>
                    ))}
                  </div>
                  <div className="text-xs opacity-70 mt-2">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg p-4 bg-surface-800 border border-surface-700">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" />
                    <div
                      className="w-2 h-2 bg-primary-500 rounded-full animate-bounce"
                      style={{ animationDelay: '0.2s' }}
                    />
                    <div
                      className="w-2 h-2 bg-primary-500 rounded-full animate-bounce"
                      style={{ animationDelay: '0.4s' }}
                    />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me anything about your training..."
            className="flex-1 bg-surface-900 text-white border border-surface-700 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
            rows={3}
            disabled={isLoading}
          />
          <Button
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading}
            className="self-end"
          >
            Send
          </Button>
        </div>
        <p className="text-xs text-surface-400 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
