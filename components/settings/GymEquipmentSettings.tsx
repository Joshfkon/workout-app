'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';

interface EquipmentType {
  id: string;
  name: string;
  category: string;
  description: string | null;
}

interface UserEquipment {
  equipment_id: string;
  is_available: boolean;
}

const CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
  machines: { label: 'Machines', emoji: '🏋️' },
  free_weights: { label: 'Free Weights', emoji: '💪' },
  benches: { label: 'Benches', emoji: '🪑' },
  racks: { label: 'Racks', emoji: '🏗️' },
  stations: { label: 'Stations', emoji: '🔩' },
  other: { label: 'Other Equipment', emoji: '🎯' },
};

export function GymEquipmentSettings() {
  const [equipmentTypes, setEquipmentTypes] = useState<EquipmentType[]>([]);
  const [userEquipment, setUserEquipment] = useState<Map<string, boolean>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const supabase = createUntypedClient();

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    setIsLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Load equipment types
    const { data: typesData } = await supabase
      .from('equipment_types')
      .select('*')
      .order('category, name');

    if (typesData) {
      setEquipmentTypes(typesData);
      
      // Default all equipment to available
      const defaultMap = new Map<string, boolean>();
      typesData.forEach(eq => defaultMap.set(eq.id, true));
      
      // Load user's equipment preferences
      const { data: userEqData } = await supabase
        .from('user_equipment')
        .select('equipment_id, is_available')
        .eq('user_id', user.id);

      if (userEqData) {
        userEqData.forEach(ue => defaultMap.set(ue.equipment_id, ue.is_available));
      }
      
      setUserEquipment(defaultMap);
    }

    setIsLoading(false);
  }

  function toggleEquipment(equipmentId: string) {
    setUserEquipment(prev => {
      const newMap = new Map(prev);
      newMap.set(equipmentId, !prev.get(equipmentId));
      return newMap;
    });
    setHasChanges(true);
  }

  function setAllCategory(category: string, available: boolean) {
    setUserEquipment(prev => {
      const newMap = new Map(prev);
      equipmentTypes
        .filter(eq => eq.category === category)
        .forEach(eq => newMap.set(eq.id, available));
      return newMap;
    });
    setHasChanges(true);
  }

  async function savePreferences() {
    setIsSaving(true);
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsSaving(false);
      return;
    }

    // Upsert all equipment preferences
    const records = Array.from(userEquipment.entries()).map(([equipment_id, is_available]) => ({
      user_id: user.id,
      equipment_id,
      is_available,
    }));

    const { error } = await supabase
      .from('user_equipment')
      .upsert(records, { onConflict: 'user_id,equipment_id' });

    if (!error) {
      setHasChanges(false);
    }

    setIsSaving(false);
  }

  // Group equipment by category
  const groupedEquipment = equipmentTypes.reduce((groups, eq) => {
    const category = eq.category || 'other';
    if (!groups[category]) groups[category] = [];
    groups[category].push(eq);
    return groups;
  }, {} as Record<string, EquipmentType[]>);

  // Count unavailable
  const unavailableCount = Array.from(userEquipment.values()).filter(v => !v).length;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-surface-400">
          Loading equipment...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>My Gym Equipment</CardTitle>
            <p className="text-sm text-surface-400 mt-1">
              Uncheck equipment you don&apos;t have access to. Workouts will only include exercises you can do.
            </p>
          </div>
          {unavailableCount > 0 && (
            <span className="text-xs bg-warning-500/20 text-warning-400 px-2 py-1 rounded-full">
              {unavailableCount} unavailable
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(groupedEquipment).map(([category, equipment]) => {
          const categoryInfo = CATEGORY_LABELS[category] || { label: category, emoji: '🔧' };
          const allAvailable = equipment.every(eq => userEquipment.get(eq.id));
          const noneAvailable = equipment.every(eq => !userEquipment.get(eq.id));

          return (
            <div key={category} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-surface-200">
                  {categoryInfo.emoji} {categoryInfo.label}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAllCategory(category, true)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      allAvailable
                        ? 'bg-success-500/20 text-success-400'
                        : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setAllCategory(category, false)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      noneAvailable
                        ? 'bg-danger-500/20 text-danger-400'
                        : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                    }`}
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {equipment.map(eq => {
                  const isAvailable = userEquipment.get(eq.id) ?? true;
                  return (
                    <button
                      key={eq.id}
                      onClick={() => toggleEquipment(eq.id)}
                      className={`p-3 rounded-lg text-left transition-all ${
                        isAvailable
                          ? 'bg-surface-800 border border-surface-700'
                          : 'bg-surface-900 border border-surface-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          isAvailable 
                            ? 'bg-success-500 border-success-500' 
                            : 'border-surface-600'
                        }`}>
                          {isAvailable && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${isAvailable ? 'text-surface-100' : 'text-surface-400 line-through'}`}>
                            {eq.name}
                          </p>
                          {eq.description && (
                            <p className="text-xs text-surface-500">{eq.description}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Save Button */}
        {hasChanges && (
          <div className="sticky bottom-0 pt-4 pb-2 bg-gradient-to-t from-surface-900 to-transparent">
            <Button
              onClick={savePreferences}
              isLoading={isSaving}
              className="w-full"
            >
              Save Equipment Preferences
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

