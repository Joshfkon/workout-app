import Image from 'next/image';

interface PhoneFrameProps {
  imageSrc: string;
  alt: string;
  caption: string;
}

function PhoneFrame({ imageSrc, alt, caption }: PhoneFrameProps) {
  return (
    <div className="flex flex-col items-center gap-3 group">
      {/* Phone frame container */}
      <div className="relative w-[260px] sm:w-[280px] md:w-[240px] lg:w-[260px]">
        {/* Phone bezel with notch */}
        <div className="relative bg-surface-900 rounded-[2.5rem] p-3 shadow-2xl shadow-black/50 ring-1 ring-surface-700/50 transition-all duration-300 group-hover:shadow-primary-500/20 group-hover:ring-primary-500/30">
          {/* Top notch area */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-surface-900 rounded-b-3xl z-10" />
          
          {/* Screen content */}
          <div className="relative bg-white rounded-[2rem] overflow-hidden aspect-[9/19.5]">
            <Image
              src={imageSrc}
              alt={alt}
              width={390}
              height={844}
              className="w-full h-full object-cover object-top"
              priority
            />
          </div>
        </div>
      </div>

      {/* Caption */}
      <p className="text-sm font-medium text-surface-300 group-hover:text-primary-400 transition-colors">
        {caption}
      </p>
    </div>
  );
}

export function PhoneShowcase() {
  const phones = [
    {
      imageSrc: '/images/landing/workout.png',
      alt: 'HyperTrack workout tracking screen showing exercise logging with sets, reps, and weight',
      caption: 'Train'
    },
    {
      imageSrc: '/images/landing/progress.png',
      alt: 'HyperTrack progress tracking screen with body composition and strength analytics',
      caption: 'Progress'
    },
    {
      imageSrc: '/images/landing/ai-coach.png',
      alt: 'HyperTrack AI Coach providing personalized training advice',
      caption: 'AI Coach'
    },
    {
      imageSrc: '/images/landing/nutrition.png',
      alt: 'HyperTrack nutrition tracking screen with macro calculator and food logging',
      caption: 'Nutrition'
    }
  ];

  return (
    <section className="w-full max-w-6xl mx-auto px-4 py-16 sm:py-20 animate-slide-up" style={{ animationDelay: '0.3s' }}>
      {/* Section header */}
      <div className="text-center mb-12">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-surface-100 mb-4">
          Everything You Need in One App
        </h2>
        <p className="text-base sm:text-lg text-surface-400 max-w-2xl mx-auto">
          Track workouts, monitor progress, get AI coaching, and hit your nutrition targets—all in one powerful platform.
        </p>
      </div>

      {/* Phone grid - Mobile: horizontal scroll, Desktop: grid */}
      <div className="relative">
        {/* Mobile: horizontal scroll with snap */}
        <div className="md:hidden overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-4 px-4">
          <div className="flex gap-6 pb-4 min-w-max">
            {phones.map((phone, index) => (
              <div key={index} className="snap-center">
                <PhoneFrame {...phone} />
              </div>
            ))}
          </div>
        </div>

        {/* Desktop: grid layout */}
        <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6 justify-items-center">
          {phones.map((phone, index) => (
            <PhoneFrame key={index} {...phone} />
          ))}
        </div>
      </div>

      {/* Scroll indicator for mobile */}
      <div className="md:hidden flex justify-center gap-2 mt-6">
        {phones.map((_, index) => (
          <div
            key={index}
            className="w-2 h-2 rounded-full bg-surface-700"
            aria-hidden="true"
          />
        ))}
      </div>
    </section>
  );
}
