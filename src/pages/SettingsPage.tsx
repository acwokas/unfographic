import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { loadSettings, saveSettings, getModelsForProvider } from '@/lib/settings';
import { AppSettings } from '@/types/layout';

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const navigate = useNavigate();
  const { toast } = useToast();

  const models = getModelsForProvider(settings.provider);
  const isOpenRouter = settings.provider === 'openrouter';

  const handleSave = () => {
    saveSettings(settings);
    toast({ title: 'Settings saved' });
  };

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" />
          <span className="font-heading text-lg font-bold text-foreground">Slide Deconstructor</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
      </nav>

      <main className="max-w-md mx-auto py-12 px-6">
        <h1 className="font-heading text-2xl font-bold text-foreground mb-8">Settings</h1>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label>AI Provider</Label>
            <Select
              value={settings.provider}
              onValueChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  provider: v as AppSettings['provider'],
                  model: v === 'openai' ? 'gpt-4o' : v === 'anthropic' ? 'claude-sonnet-4-20250514' : '',
                }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              placeholder="sk-..."
              value={settings.apiKey}
              onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Stored locally in your browser. Never sent anywhere except the AI provider.</p>
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            {isOpenRouter ? (
              <Input
                placeholder="e.g. google/gemini-pro-vision"
                value={settings.model}
                onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
              />
            ) : (
              <Select
                value={settings.model}
                onValueChange={(v) => setSettings((s) => ({ ...s, model: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label>Default Slide Size</Label>
            <Select
              value={settings.slideSize}
              onValueChange={(v) => setSettings((s) => ({ ...s, slideSize: v as '16:9' | '4:3' }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="16:9">16:9 (Widescreen)</SelectItem>
                <SelectItem value="4:3">4:3 (Standard)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleSave} className="w-full">
            <Save className="h-4 w-4 mr-2" /> Save Settings
          </Button>
        </div>
      </main>
    </div>
  );
}
