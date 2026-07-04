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
        <section className="relative min-h-[870px] flex items-center bg-surface-container-lowest overflow-hidden">
            <div className="max-w-screen-2xl mx-auto px-gutter grid md:grid-cols-12 items-center gap-12 w-full">

                {/* Left content */}
                <motion.div
                    className="md:col-span-6 space-y-8 z-10 py-12"
                    variants={container}
                    initial="hidden"
                    animate="show"
                >
                    <motion.div
                        variants={item}
                        className="inline-block px-4 py-1.5 bg-primary-fixed text-on-primary-fixed rounded-full font-label-md text-label-md font-bold tracking-wide uppercase"
                    >
                        INDIA'S FASTEST-GROWING RENTAL PLATFORM
                    </motion.div>

                    <motion.h1 variants={item} className="font-display text-display leading-tight">
                        Rent. Ride. Repeat.{' '}
                        <span className="text-primary">
                            Explore the Himalayas
                        </span>{' '}
                        on your own terms.
                    </motion.h1>

                    <motion.div variants={item}>
                        <SearchWidget />
                    </motion.div>

                    {/* Trust row */}
                    <motion.div variants={item} className="flex flex-wrap gap-4 items-center opacity-80">
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

                {/* Right – hero image */}
                <motion.div
                    className="md:col-span-6 relative h-[600px] flex items-center justify-center"
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
                >
                    <div className="absolute inset-0 rounded-full blur-3xl opacity-10 bg-primary" />

                    <div className="relative w-full h-full flex items-center justify-center perspective-1000">
                        <div className="bg-surface-container w-4/5 h-[20px] absolute bottom-1/4 rounded-[100%] opacity-20 blur-xl" />

                        <img
                            alt="Luxury Motorcycle"
                            className="w-full h-auto object-contain drop-shadow-2xl z-10 rotate-y-12"
                            src="https://lh3.googleusercontent.com/aida-public/AB6AXuAlFTsemsAE3PvgrWne188Q_eHfFfvpyQU-Rypj4BFHMRYRUbga_TmOrwXFe_Xulk5PL6Ae_ELT-_y7gY6nE5RCA8b8Kxq3lVVz_8TgBLlG6e_LLrJU4wVQ-1ziHlW7IXoEv3KcZCJg5Wk8TGHGZB6xfbL1SUUo704PRMEUUSwg2cMP4VIFcLC7HPtwnepE9PHZA3wCsP0d9T9wTIwE5IX4o3DSXXA5pImSxY3dqjZvF06KAV7j25yftGQ5mrh50XjGOe0ZyqoBWhZO"
                        />
                    </div>
                </motion.div>
            </div>
        </section>
    )
}
