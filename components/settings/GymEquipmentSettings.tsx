'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Modal } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  LOCATION_PRESETS,
  locationIcon,
  presetUnavailableEquipmentIds,
  type LocationPreset,
} from '@/services/locationProfiles';

interface EquipmentType {
  id: string;
  name: string;
  category: string;
  description: string | null;
}

interface UserEquipment {
  equipment_id: string;
  is_available: boolean;
  location_id?: string | null;
}

interface GymLocation {
  id: string;
  name: string;
  is_default: boolean;
  icon?: string | null;
  preset_kind?: string | null;
  dumbbell_max_kg?: number | null;
  created_at?: string;
  updated_at?: string;
}

const CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
  machines: { label: 'Machines', emoji: '🏋️' },
  free_weights: { label: 'Free weights', emoji: '💪' },
  benches: { label: 'Benches', emoji: '🪑' },
  racks: { label: 'Racks', emoji: '🏗️' },
  stations: { label: 'Stations', emoji: '🔩' },
  other: { label: 'Other equipment', emoji: '🎯' },
};

export function GymEquipmentSettings() {
  const [equipmentTypes, setEquipmentTypes] = useState<EquipmentType[]>([]);
  const [locations, setLocations] = useState<GymLocation[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [userEquipment, setUserEquipment] = useState<Map<string, boolean>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Location management state
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<GymLocation | null>(null);
  const [locationName, setLocationName] = useState('');
  const [locationPreset, setLocationPreset] = useState<LocationPreset | null>(null);
  const [dumbbellMax, setDumbbellMax] = useState('');
  const [isDeletingLocation, setIsDeletingLocation] = useState(false);
  const [openLocationMenuId, setOpenLocationMenuId] = useState<string | null>(null);

  const supabase = createUntypedClient();

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    setIsLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Load gym locations (with error handling for missing table or columns)
    let locationsData: GymLocation[] | null = null;
    try {
      // Load without ordering first (in case column doesn't exist)
      let { data, error } = await supabase
        .from('gym_locations')
        .select('*')
        .eq('user_id', user.id);
      
      if (error) {
        // Check if it's a column error (42703) - column doesn't exist
        if (error.code === '42703' || error.message?.includes('does not exist') || error.message?.includes('column')) {
          console.warn('gym_locations table or column not found, using fallback mode:', error);
          locationsData = null;
        } else if (error.code === 'PGRST205') {
          console.warn('gym_locations table not found, using fallback mode:', error);
          locationsData = null;
        } else {
          console.warn('Error loading gym locations:', error);
          locationsData = null;
        }
      } else if (data) {
        // Success - sort manually to ensure correct order (handles missing is_default gracefully)
        data = data.sort((a: any, b: any) => {
          // Handle missing is_default column
          const aDefault = a.is_default ?? false;
          const bDefault = b.is_default ?? false;
          if (aDefault !== bDefault) {
            return aDefault ? -1 : 1;
          }
          const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
          return aDate - bDate;
        });
        locationsData = data;
      }
    } catch (err) {
      console.warn('Error loading gym locations, using fallback mode:', err);
      locationsData = null;
    }

    if (locationsData && locationsData.length > 0) {
      setLocations(locationsData);
      // Select default location or first location
      const defaultLocation = locationsData.find(l => l.is_default) || locationsData[0];
      setSelectedLocationId(defaultLocation.id);
    } else {
      // Try to create default location if table exists, otherwise use fallback
      try {
        // First check if a default already exists (might have been created by migration or another request)
        const { data: existingDefault } = await supabase
          .from('gym_locations')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_default', true)
          .limit(1)
          .maybeSingle();

        if (existingDefault) {
          setLocations([existingDefault]);
          setSelectedLocationId(existingDefault.id);
        } else {
          // Try to create default location
          const { data: newLocation, error: insertError } = await supabase
            .from('gym_locations')
            .insert({ user_id: user.id, name: 'Home Gym', is_default: true })
            .select()
            .single();
          
          if (newLocation && !insertError) {
            setLocations([newLocation]);
            setSelectedLocationId(newLocation.id);
          } else if (insertError?.code === '23505' || insertError?.code === 'PGRST116' || insertError?.status === 409) {
            // Unique constraint violation - default already exists, fetch it
            const { data: fetchedDefault } = await supabase
              .from('gym_locations')
              .select('*')
              .eq('user_id', user.id)
              .eq('is_default', true)
              .limit(1)
              .maybeSingle();
            
            if (fetchedDefault) {
              setLocations([fetchedDefault]);
              setSelectedLocationId(fetchedDefault.id);
            } else {
              // Use fallback
              const fallbackLocation: GymLocation = {
                id: 'fallback',
                name: 'Home Gym',
                is_default: true,
              };
              setLocations([fallbackLocation]);
              setSelectedLocationId('fallback');
            }
          } else {
            // Table doesn't exist or other error - use fallback
            const fallbackLocation: GymLocation = {
              id: 'fallback',
              name: 'Home Gym',
              is_default: true,
            };
            setLocations([fallbackLocation]);
            setSelectedLocationId('fallback');
          }
        }
      } catch (err) {
        // Table doesn't exist - use fallback
        const fallbackLocation: GymLocation = {
          id: 'fallback',
          name: 'Home Gym',
          is_default: true,
        };
        setLocations([fallbackLocation]);
        setSelectedLocationId('fallback');
      }
    }

    // Load equipment types
    const { data: typesData } = await supabase
      .from('equipment_types')
      .select('*')
      .order('category, name');

    if (typesData) {
      setEquipmentTypes(typesData);
      
      // Load user's equipment preferences for the selected location
      if (selectedLocationId) {
        await loadEquipmentForLocation(selectedLocationId, typesData);
      } else {
        // Default all equipment to available
        const defaultMap = new Map<string, boolean>();
        typesData.forEach((eq: EquipmentType) => defaultMap.set(eq.id, true));
        setUserEquipment(defaultMap);
      }
    }

    setIsLoading(false);
  }

  async function loadEquipmentForLocation(locationId: string, types?: EquipmentType[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const equipmentList = types || equipmentTypes;
    
    // Default all equipment to available
    const defaultMap = new Map<string, boolean>();
    equipmentList.forEach((eq: EquipmentType) => defaultMap.set(eq.id, true));
    
    // For fallback location (migration not run), load old-style preferences without location_id
    if (locationId === 'fallback') {
      const { data: userEqData } = await supabase
        .from('user_equipment')
        .select('equipment_id, is_available')
        .eq('user_id', user.id)
        .is('location_id', null);

      if (userEqData) {
        userEqData.forEach((ue: UserEquipment) => defaultMap.set(ue.equipment_id, ue.is_available));
      }
    } else {
      // Load user's equipment preferences for this location
      const { data: userEqData } = await supabase
        .from('user_equipment')
        .select('equipment_id, is_available')
        .eq('user_id', user.id)
        .eq('location_id', locationId);

      if (userEqData) {
        userEqData.forEach((ue: UserEquipment) => defaultMap.set(ue.equipment_id, ue.is_available));
      }
    }
    
    setUserEquipment(defaultMap);
    setHasChanges(false);
  }

  // Reload equipment when location changes
  useEffect(() => {
    if (selectedLocationId && equipmentTypes.length > 0) {
      loadEquipmentForLocation(selectedLocationId, equipmentTypes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocationId, equipmentTypes.length]);

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
    if (!selectedLocationId) return;
    
    setIsSaving(true);
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setIsSaving(false);
      return;
    }

    // For fallback location (migration not run), save without location_id
    const records = Array.from(userEquipment.entries()).map(([equipment_id, is_available]) => {
      const record: any = {
        user_id: user.id,
        equipment_id,
        is_available,
      };
      // Only add location_id if it's not the fallback
      if (selectedLocationId !== 'fallback') {
        record.location_id = selectedLocationId;
      }
      return record;
    });

    // Use appropriate conflict resolution based on whether location_id exists
    const conflictColumns = selectedLocationId === 'fallback' 
      ? 'user_id,equipment_id' 
      : 'user_id,equipment_id,location_id';

    const { error } = await supabase
      .from('user_equipment')
      .upsert(records, { onConflict: conflictColumns });

    if (!error) {
      setHasChanges(false);
    }

    setIsSaving(false);
  }

  function handleCreateLocation() {
    setEditingLocation(null);
    setLocationName('');
    setLocationPreset(null);
    setDumbbellMax('');
    setShowLocationModal(true);
  }

  async function handleEditLocation(location: GymLocation) {
    setEditingLocation(location);
    setLocationName(location.name);
    setLocationPreset(null);
    setDumbbellMax(location.dumbbell_max_kg != null ? String(location.dumbbell_max_kg) : '');
    setShowLocationModal(true);
  }

  function handlePickPreset(preset: LocationPreset) {
    setLocationPreset(preset);
    // Prefill the name from the preset, but only if the user hasn't typed one.
    if (!locationName.trim() || LOCATION_PRESETS.some((p) => p.name === locationName)) {
      setLocationName(preset.name);
    }
  }

  function parsedDumbbellMax(): number | null {
    const value = parseFloat(dumbbellMax);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  async function handleSaveLocation() {
    if (!locationName.trim()) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (editingLocation) {
      // Update existing location (retry name-only if the profile columns
      // haven't been migrated yet)
      let { data, error } = await supabase
        .from('gym_locations')
        .update({ name: locationName.trim(), dumbbell_max_kg: parsedDumbbellMax() })
        .eq('id', editingLocation.id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) {
        ({ data, error } = await supabase
          .from('gym_locations')
          .update({ name: locationName.trim() })
          .eq('id', editingLocation.id)
          .eq('user_id', user.id)
          .select()
          .single());
      }

      if (!error && data) {
        setLocations(locations.map(l => l.id === data.id ? data : l));
        setShowLocationModal(false);
        setEditingLocation(null);
        setLocationName('');
      }
    } else {
      // Create new location, optionally seeded from a preset (icon + a
      // pre-checked equipment inventory the user can then edit). Retries
      // without the profile columns if the migration hasn't run yet.
      let { data, error } = await supabase
        .from('gym_locations')
        .insert({
          user_id: user.id,
          name: locationName.trim(),
          is_default: locations.length === 0,
          icon: locationPreset?.icon ?? null,
          preset_kind: locationPreset?.kind ?? 'custom',
          dumbbell_max_kg: parsedDumbbellMax(),
        })
        .select()
        .single();

      if (error) {
        ({ data, error } = await supabase
          .from('gym_locations')
          .insert({
            user_id: user.id,
            name: locationName.trim(),
            is_default: locations.length === 0,
          })
          .select()
          .single());
      }

      if (!error && data) {
        if (locationPreset) {
          const unavailable = presetUnavailableEquipmentIds(locationPreset);
          if (unavailable.length > 0) {
            await supabase.from('user_equipment').upsert(
              unavailable.map((equipmentId) => ({
                user_id: user.id,
                equipment_id: equipmentId,
                is_available: false,
                location_id: data.id,
              })),
              { onConflict: 'user_id,equipment_id,location_id' }
            );
          }
        }
        setLocations([...locations, data]);
        setSelectedLocationId(data.id);
        setShowLocationModal(false);
        setLocationName('');
        setLocationPreset(null);
      }
    }
  }

  async function handleDeleteLocation(locationId: string) {
    if (!confirm('Are you sure you want to delete this location? All equipment preferences for this location will be lost.')) {
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setIsDeletingLocation(true);

    const { error } = await supabase
      .from('gym_locations')
      .delete()
      .eq('id', locationId)
      .eq('user_id', user.id);

    if (!error) {
      const updatedLocations = locations.filter(l => l.id !== locationId);
      setLocations(updatedLocations);
      
      // If we deleted the selected location, switch to another one
      if (selectedLocationId === locationId) {
        const newSelected = updatedLocations.find(l => l.is_default) || updatedLocations[0];
        if (newSelected) {
          setSelectedLocationId(newSelected.id);
        } else {
          setSelectedLocationId(null);
        }
      }
    }

    setIsDeletingLocation(false);
  }

  async function handleSetDefaultLocation(locationId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // First, unset all defaults
    await supabase
      .from('gym_locations')
      .update({ is_default: false })
      .eq('user_id', user.id);

    // Then set the new default
    const { data, error } = await supabase
      .from('gym_locations')
      .update({ is_default: true })
      .eq('id', locationId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (!error && data) {
      setLocations(locations.map(l => ({
        ...l,
        is_default: l.id === locationId
      })));
    }
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
        <CardContent className="py-8 text-center text-ink-2">
          Loading equipment...
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>My gym equipment</CardTitle>
              <p className="text-body text-ink-2 mt-1">
                Uncheck equipment you don&apos;t have access to. Workouts will only include exercises you can do.
              </p>
            </div>
            {unavailableCount > 0 && (
              <span className="text-caption bg-status-warn/20 text-status-warn px-2 py-1 rounded-full">
                {unavailableCount} unavailable
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Location Tabs */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-body font-medium text-ink">
                Gym location
              </label>
              <Button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCreateLocation();
                }}
                variant="outline"
                size="sm"
                disabled={selectedLocationId === 'fallback' || locations.length === 0}
                className="relative z-30"
              >
                <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add location
              </Button>
            </div>
            
            <div className="flex gap-2 flex-wrap">
              {locations.length === 0 && (
                <p className="text-body text-ink-2">
                  No locations found. Please run the database migration to enable location management.
                </p>
              )}
              {locations.map((location) => (
                <div key={location.id} className="relative">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setSelectedLocationId(location.id)}
                      className={`px-4 py-2 rounded-lg text-subhead font-medium transition-colors ${
                        selectedLocationId === location.id
                          ? 'bg-action text-on-action'
                          : 'bg-fill text-ink-2 hover:bg-sep'
                      }`}
                    >
                      <span aria-hidden="true">
                        {locationIcon({
                          icon: location.icon ?? null,
                          presetKind:
                            (location.preset_kind as 'gym' | 'home' | 'travel' | 'custom' | null) ??
                            null,
                        })}
                      </span>{' '}
                      {location.name}
                      {location.is_default && (
                        <span className="ml-1 text-caption opacity-75">(Default)</span>
                      )}
                    </button>
                    
                    {/* Location actions menu button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenLocationMenuId(openLocationMenuId === location.id ? null : location.id);
                      }}
                      className="p-2 rounded-lg text-ink-2 hover:bg-sep hover:text-ink transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* Location actions menu */}
                  {openLocationMenuId === location.id && (
                    <>
                      <div 
                        className="fixed inset-0 z-10" 
                        onClick={() => setOpenLocationMenuId(null)}
                      />
                      <div className="absolute right-0 top-full mt-1 z-20 bg-fill border border-sep rounded-lg shadow-lg p-1 min-w-[140px]">
                        {!location.is_default && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetDefaultLocation(location.id);
                              setOpenLocationMenuId(null);
                            }}
                            className="w-full text-left px-3 py-1.5 text-caption text-ink-2 hover:bg-sep rounded"
                          >
                            Set as default
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditLocation(location);
                            setOpenLocationMenuId(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-caption text-ink-2 hover:bg-sep rounded"
                        >
                          Edit
                        </button>
                      {locations.length > 1 && location.id !== 'fallback' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteLocation(location.id);
                            setOpenLocationMenuId(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-caption text-status-bad hover:bg-sep rounded"
                          disabled={isDeletingLocation}
                        >
                          Delete
                        </button>
                      )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        {Object.entries(groupedEquipment).map(([category, equipment]) => {
          const categoryInfo = CATEGORY_LABELS[category] || { label: category, emoji: '🔧' };
          const allAvailable = equipment.every(eq => userEquipment.get(eq.id));
          const noneAvailable = equipment.every(eq => !userEquipment.get(eq.id));

          return (
            <div key={category} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-body font-medium text-ink">
                  {categoryInfo.label}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAllCategory(category, true)}
                    className={`text-caption px-2 py-1 rounded transition-colors ${
                      allAvailable
                        ? 'bg-status-ok/20 text-status-ok'
                        : 'bg-fill text-ink-2 hover:text-ink'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setAllCategory(category, false)}
                    className={`text-caption px-2 py-1 rounded transition-colors ${
                      noneAvailable
                        ? 'bg-status-bad/20 text-status-bad'
                        : 'bg-fill text-ink-2 hover:text-ink'
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
                          ? 'bg-fill border border-sep'
                          : 'bg-card opacity-60 shadow-card'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          isAvailable 
                            ? 'bg-status-ok border-status-ok' 
                            : 'border-sep'
                        }`}>
                          {isAvailable && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <p className={`text-subhead font-medium ${isAvailable ? 'text-ink' : 'text-ink-2 line-through'}`}>
                            {eq.name}
                          </p>
                          {eq.description && (
                            <p className="text-caption text-ink-3">{eq.description}</p>
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
            <div className="sticky bottom-0 pt-4 pb-2 bg-card to-transparent">
              <Button
                onClick={savePreferences}
                isLoading={isSaving}
                className="w-full"
              >
                Save equipment preferences
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Location Modal */}
      <Modal
        isOpen={showLocationModal}
        onClose={() => {
          setShowLocationModal(false);
          setEditingLocation(null);
          setLocationName('');
        }}
        title={editingLocation ? 'Edit location' : 'Add new location'}
      >
        <div className="space-y-4">
          {!editingLocation && (
            <div className="space-y-2">
              <label className="block text-body font-medium text-ink">
                Start from a preset
              </label>
              <div className="flex gap-2 flex-wrap">
                {LOCATION_PRESETS.map((preset) => (
                  <button
                    key={preset.kind}
                    onClick={() => handlePickPreset(preset)}
                    className={`px-3 py-2 rounded-lg text-subhead transition-colors ${
                      locationPreset?.kind === preset.kind
                        ? 'bg-action/20 border border-action text-action'
                        : 'bg-fill border border-transparent text-ink-2 hover:bg-sep'
                    }`}
                  >
                    {preset.icon} {preset.name}
                  </button>
                ))}
                <button
                  onClick={() => setLocationPreset(null)}
                  className={`px-3 py-2 rounded-lg text-subhead transition-colors ${
                    locationPreset === null
                      ? 'bg-action/20 border border-action text-action'
                      : 'bg-fill border border-transparent text-ink-2 hover:bg-sep'
                  }`}
                >
                  Custom
                </button>
              </div>
              <p className="text-caption text-ink-3">
                Presets pre-check the equipment checklist (Gym: everything; Home: dumbbells,
                bands, bench, pull-up bar; Hotel: dumbbells + bands). You can edit it after.
              </p>
            </div>
          )}

          <Input
            label="Location name"
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="e.g., home gym, commercial gym, work gym"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && locationName.trim()) {
                handleSaveLocation();
              }
            }}
          />

          <Input
            label="Heaviest dumbbell (kg, optional)"
            type="number"
            value={dumbbellMax}
            onChange={(e) => setDumbbellMax(e.target.value)}
            placeholder="e.g., 25"
          />
          
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setShowLocationModal(false);
                setEditingLocation(null);
                setLocationName('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveLocation}
              disabled={!locationName.trim()}
            >
              {editingLocation ? 'Save changes' : 'Create location'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

