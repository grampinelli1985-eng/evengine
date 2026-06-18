/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from 'motion/react';

export default function SkeletonMatch() {
  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-4 space-y-4">
      <div className="flex justify-between items-center">
        <motion.div 
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="h-4 w-24 bg-gray-700 rounded"
        />
        <motion.div 
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
          className="h-4 w-16 bg-gray-700 rounded"
        />
      </div>
      <div className="space-y-2">
        <motion.div 
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
          className="h-6 w-full bg-gray-700 rounded"
        />
        <motion.div 
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: 0.6 }}
          className="h-6 w-3/4 bg-gray-700 rounded"
        />
      </div>
      <motion.div 
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 1.5, repeat: Infinity, delay: 0.8 }}
        className="h-10 w-full bg-gray-700 rounded-lg"
      />
    </div>
  );
}
