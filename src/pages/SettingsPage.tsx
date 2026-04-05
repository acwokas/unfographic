import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { loadSettings, saveSettings, getModelsForProvider } from '@/lib/settings';
import { AppSettings } from '@/types/layout';

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const navigate = useNavigate();
  const { toast } = useToast();

  const models = getModelsForProvider(settings.provider);
  const isOpenRouter = settings.provider === 'openrouter';
  const useCustomApiKey = Boolean(settings.useCustomApiKey);

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
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="custom-api-toggle">Use your own API key</Label>
                <p className="text-xs text-muted-foreground">Off by default for shared links — the app uses server-side keys instead.</p>
              </div>
              <Switch
                id="custom-api-toggle"
                checked={useCustomApiKey}
                onCheckedChange={(checked) => setSettings((s) => ({ ...s, useCustomApiKey: checked }))}
              />
            </div>
          </div>

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
              disabled={!useCustomApiKey}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
              </SelectContent>
            </Select>
            {!useCustomApiKey && <p className="text-xs text-muted-foreground">Shared mode uses the app's default backend provider.</p>}
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              placeholder="sk-..."
              value={settings.apiKey}
              disabled={!useCustomApiKey}
              onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">Stored locally in your browser and only used when custom key mode is enabled.</p>
          </div>

          <div className="space-y-2">
            <Label>Model</Label>
            {isOpenRouter ? (
              <Input
                placeholder="e.g. google/gemini-pro-vision"
                value={settings.model}
                disabled={!useCustomApiKey}
                onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
              />
            ) : (
              <Select
                value={settings.model}
                onValueChange={(v) => setSettings((s) => ({ ...s, model: v }))}
                disabled={!useCustomApiKey}
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
