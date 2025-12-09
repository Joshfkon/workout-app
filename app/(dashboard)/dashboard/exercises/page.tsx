'use client';

import { useState, useEffect } from 'react';
import { Card, Input, Badge, Button } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { MUSCLE_GROUPS } from '@/types/schema';

interface Exercise {
  id: string;
  name: string;
  primary_muscle: string;
  mechanic: 'compound' | 'isolation';
}

export default function ExercisesPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);

  useEffect(() => {
    async function fetchExercises() {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, mechanic')
        .order('name');

      if (data && !error) {
        setExercises(data);
      }
      setIsLoading(false);
    }

    fetchExercises();
  }, []);

  const filteredExercises = exercises.filter((ex) => {
    const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase());
    const matchesMuscle = !selectedMuscle || ex.primary_muscle === selectedMuscle;
    return matchesSearch && matchesMuscle;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Exercise Library</h1>
          <p className="text-surface-400 mt-1">
            {isLoading ? 'Loading...' : `${exercises.length} exercises available`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search exercises..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Muscle filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedMuscle(null)}
          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
            !selectedMuscle
              ? 'bg-primary-500 text-white'
              : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
          }`}
        >
          All
        </button>
        {MUSCLE_GROUPS.map((muscle) => (
          <button
            key={muscle}
            onClick={() => setSelectedMuscle(muscle)}
            className={`px-3 py-1.5 rounded-full text-sm capitalize transition-colors ${
              selectedMuscle === muscle
                ? 'bg-primary-500 text-white'
                : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
            }`}
          >
            {muscle}
          </button>
        ))}
      </div>

      {/* Exercise list */}
      {isLoading ? (
        <div className="grid gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="h-16 bg-surface-800 rounded" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredExercises.map((exercise) => (
            <Card
              key={exercise.id}
              className="hover:border-surface-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-surface-100">{exercise.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-surface-500 capitalize">
                      {exercise.primary_muscle}
                    </span>
                    <span className="text-surface-700">•</span>
                    <Badge variant={exercise.mechanic === 'compound' ? 'info' : 'default'} size="sm">
                      {exercise.mechanic}
                    </Badge>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && filteredExercises.length === 0 && (
        <Card className="text-center py-12">
          <p className="text-surface-400">No exercises found</p>
          <p className="text-sm text-surface-500 mt-1">
            Try adjusting your search or filters
          </p>
        </Card>
      )}
    </div>
  );
}
