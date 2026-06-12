import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Brain, Loader2 } from 'lucide-react';
import { api } from '@/api/client';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function HealthChatBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: text };
    const history = messages;
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const data = await api.post<{ reply: string }>('/insights/chat', {
        message: text,
        history,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: "Sorry, I couldn't reach the server. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Floating bubble */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full px-4 py-3 shadow-lg text-white text-sm font-semibold transition-transform hover:scale-105 active:scale-95"
          style={{ background: 'linear-gradient(135deg, #91c5bf 0%, #6da7cc 100%)' }}
          aria-label="Ask about your health"
        >
          <Brain className="h-4 w-4" />
          <span className="hidden sm:inline">Ask Fila</span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-5 right-5 z-50 flex flex-col rounded-2xl shadow-2xl border border-gray-200 bg-white overflow-hidden"
          style={{ width: 'min(380px, calc(100vw - 20px))', height: 'min(520px, calc(100vh - 80px))' }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ background: 'linear-gradient(135deg, #91c5bf 0%, #6da7cc 100%)' }}
          >
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-white" />
              <span className="text-sm font-semibold text-white">Ask Fila</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-white/80 hover:text-white transition-colors"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-gray-50">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-3">
                <Brain className="h-8 w-8" style={{ color: '#6da7cc' }} />
                <p className="text-sm text-gray-700 font-medium">Ask anything about your health records</p>
                <p className="text-xs text-gray-400">Questions about your labs, medications, conditions, or patterns in your data.</p>
                <div className="flex flex-col gap-1.5 w-full mt-2">
                  {[
                    'What medications am I currently taking?',
                    'Are any of my labs flagged as abnormal?',
                    'What patterns do you see in my health data?',
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); inputRef.current?.focus(); }}
                      className="text-left px-3 py-2 rounded-lg text-xs text-gray-600 bg-white border border-gray-200 hover:border-[#6da7cc] hover:text-[#2b4257] transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed"
                  style={msg.role === 'user'
                    ? { background: '#2b4257', color: '#fff', borderBottomRightRadius: 4 }
                    : { background: '#fff', color: '#1f2937', border: '1px solid #e5e7eb', borderBottomLeftRadius: 4 }}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3 py-2 bg-white border border-gray-200 flex items-center gap-1.5" style={{ borderBottomLeftRadius: 4 }}>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                  <span className="text-xs text-gray-400">Thinking…</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 flex items-end gap-2 px-3 py-3 border-t bg-white">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your health…"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6da7cc]/40 leading-snug"
              style={{ maxHeight: 96, overflowY: 'auto' }}
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="shrink-0 flex items-center justify-center h-9 w-9 rounded-xl text-white disabled:opacity-40 transition-opacity"
              style={{ background: '#2b4257' }}
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
