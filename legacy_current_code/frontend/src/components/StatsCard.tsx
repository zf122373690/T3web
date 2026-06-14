import React from "react";
import {cn} from "@/lib/utils.ts";

export interface Props {
    label: string;
    value?: number | string;
    icon: React.FC<{ size: number } & React.SVGProps<SVGSVGElement>>;
    unit?: string;
    subValue?: string;
    colorClass: string;
}

export const StatCard = ({label, value, icon: Icon, unit, subValue, colorClass}: Props) => (
    <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm flex items-start justify-between">
        <div>
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
            <div className="flex items-baseline space-x-1">
                <span className="text-2xl font-bold text-gray-900">{value}</span>
                {unit && <span className="text-sm text-gray-500 font-medium">{unit}</span>}
            </div>
            {subValue && <div className="mt-1 text-xs text-gray-400">{subValue}</div>}
        </div>
        <div className={cn(
            `p-2.5 rounded-lg`
            , colorClass,
        )}>
            <Icon size={20} className={colorClass.replace('bg-', 'text-')}/>
        </div>
    </div>
);