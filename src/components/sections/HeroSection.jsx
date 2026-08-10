import { motion } from 'framer-motion'
import SearchWidget from '@/components/sections/SearchWidget'

const container = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.15, delayChildren: 0.1 },
    },
}

const item = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
}

export default function HeroSection() {
    return (
        <section className="relative min-h-[600px] flex items-center bg-surface-container-lowest overflow-hidden">
            <div className="max-w-screen-2xl mx-auto px-gutter grid md:grid-cols-12 items-center gap-12 w-full">

                {/* Content */}
                <motion.div
                    className="md:col-span-12 space-y-8 z-10 py-4 max-w-3xl mx-auto flex flex-col items-center"
                    variants={container}
                    initial="hidden"
                    animate="show"
                >



                    <motion.div variants={item} className="w-full flex justify-center">
                        <SearchWidget />
                    </motion.div>

                    {/* Trust row */}
                    <motion.div variants={item} className="flex flex-wrap justify-center gap-4 items-center opacity-80">
                        {[
                            { icon: 'verified_user', label: 'Verified Hosts' },
                            { icon: 'speed', label: 'Instant Booking' },
                            { icon: 'security', label: 'Fully Insured' },
                        ].map(item => (
                            <div
                                key={item.label}
                                className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-high rounded-full"
                            >
                                <span
                                    className="material-symbols-outlined text-[18px]"
                                    style={{ fontVariationSettings: "'FILL' 1" }}
                                >
                                    {item.icon}
                                </span>

                                <span className="text-label-md font-label-md">
                                    {item.label}
                                </span>
                            </div>
                        ))}
                    </motion.div>
                </motion.div>


            </div>
        </section>
    )
}
