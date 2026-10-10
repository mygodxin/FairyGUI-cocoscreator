/// <reference path="GObject.ts" />

namespace fgui {
    /**
     * 两节点画线模块 - 用于在GComponent之间绘制连线
     * 
     * 使用方式:
     * ```typescript
     * // 在同一个父GComponent中连接两个子节点
     * let connector = new GLineConnector(parentComponent);
     * connector.connect(nodeA, nodeB);
     * connector.lineColor = new cc.Color(255, 0, 0);
     * connector.lineWidth = 3;
     * ```
     * 
     * GLineConnector - A line connector module for drawing connections between GComponents
     */
    export class GLineConnector {
        private _node: cc.Node;
        private _graphics: cc.Graphics;
        private _from: GObject;
        private _to: GObject;
        private _lineWidth: number = 2;
        private _lineColor: cc.Color = new cc.Color(255, 255, 255, 255);
        private _fromColor: cc.Color;
        private _toColor: cc.Color;
        private _fromOffset: cc.Vec2 = new cc.Vec2(0, 0);
        private _toOffset: cc.Vec2 = new cc.Vec2(0, 0);
        private _visible: boolean = true;
        private _dirty: boolean = false;
        private _curve: number = 0; // 0=直线, (0-1]贝塞尔曲线弯曲强度
        private _dashed: boolean = false;
        private _dashLength: number = 10;
        private _gapLength: number = 5;

        // 箭头相关
        private _showArrow: boolean = false;
        private _arrowSize: number = 10;

        // 连接点类型
        private _fromLinker: LinkerType = LinkerType.Auto;
        private _toLinker: LinkerType = LinkerType.Auto;

        // 监听器引用（用于清理）
        private _fromXYHandler: Function;
        private _fromSizeHandler: Function;
        private _toXYHandler: Function;
        private _toSizeHandler: Function;

        // 公共调度器用于延迟更新
        private _scheduled: boolean = false;

        constructor(owner?: GComponent) {
            this._node = new cc.Node("GLineConnector");
            this._graphics = this._node.addComponent(cc.Graphics);

            // 绑定markDirty到this
            this._fromXYHandler = this.markDirty.bind(this);
            this._fromSizeHandler = this.markDirty.bind(this);
            this._toXYHandler = this.markDirty.bind(this);
            this._toSizeHandler = this.markDirty.bind(this);

            if (owner) {
                this.addTo(owner);
            }
        }

        /**
         * 添加到指定的GComponent中
         */
        public addTo(owner: GComponent): void {
            if (this._node.parent !== owner.displayListContainer) {
                this._node.parent = owner.displayListContainer;
                // 确保画线在子节点之下
                this._node.setSiblingIndex(0);
            }
        }

        /**
         * 从父节点移除
         */
        public removeFromParent(): void {
            if (this._node.parent) {
                this._node.removeFromParent(false);
            }
        }

        /**
         * 连接两个GObject
         */
        public connect(from: GObject, to: GObject): void {
            // 移除旧监听
            this.disconnect();

            this._from = from;
            this._to = to;

            // 监听位置和大小变化
            if (this._from) {
                this._from.on(Event.XY_CHANGED, this._fromXYHandler as any, this);
                this._from.on(Event.SIZE_CHANGED, this._fromSizeHandler as any, this);
            }
            if (this._to) {
                this._to.on(Event.XY_CHANGED, this._toXYHandler as any, this);
                this._to.on(Event.SIZE_CHANGED, this._toSizeHandler as any, this);
            }

            this.markDirty();
        }

        /**
         * 断开连接
         */
        public disconnect(): void {
            if (this._from) {
                this._from.off(Event.XY_CHANGED, this._fromXYHandler as any, this);
                this._from.off(Event.SIZE_CHANGED, this._fromSizeHandler as any, this);
            }
            if (this._to) {
                this._to.off(Event.XY_CHANGED, this._toXYHandler as any, this);
                this._to.off(Event.SIZE_CHANGED, this._toSizeHandler as any, this);
            }
            this._from = null;
            this._to = null;
            this.clear();
            this._scheduled = false;
        }

        /**
         * 延迟更新标记 - 避免频繁重绘
         */
        private markDirty(): void {
            if (this._dirty) return;
            this._dirty = true;

            if (!this._scheduled) {
                this._scheduled = true;
                // 下一帧更新
                cc.director.getScheduler().schedule(this._doUpdateLine.bind(this), this, 0, 0, 0, false);
            }
        }

        private _doUpdateLine(dt: number): void {
            this._scheduled = false;
            // 取消调度
            cc.director.getScheduler().unschedule(this._doUpdateLine, this);
            this.updateLine();
        }

        /**
         * 清除连线
         */
        public clear(): void {
            this._graphics.clear();
            this._dirty = false;
        }

        /**
         * 更新连线绘制
         */
        public updateLine(): void {
            this._dirty = false;

            if (!this._visible || !this._from || !this._to) {
                this._graphics.clear();
                return;
            }

            this._graphics.clear();

            // 获取连接点（在父容器坐标系中）
            let fromPt: cc.Vec2 = this.getLinkerPoint(this._from, this._fromLinker, this._fromOffset);
            let toPt: cc.Vec2 = this.getLinkerPoint(this._to, this._toLinker, this._toOffset);

            // Auto模式: 根据相对位置自动选择最佳连接点
            if (this._fromLinker == LinkerType.Auto) {
                fromPt = this.getAutoLinkerPoint(this._from, toPt, this._fromOffset);
            }
            if (this._toLinker == LinkerType.Auto) {
                toPt = this.getAutoLinkerPoint(this._to, fromPt, this._toOffset);
            }

            // 绘制连线
            this.drawConnection(fromPt, toPt);
        }

        /**
         * 自动计算最佳连接点 - 选择离目标最近的边缘点
         */
        private getAutoLinkerPoint(target: GObject, targetPt: cc.Vec2, offset: cc.Vec2): cc.Vec2 {
            let cx: number = target.x + target.width / 2;
            let cy: number = target.y + target.height / 2;

            // 计算目标相对于target中心的方向
            let dx: number = targetPt.x - cx;
            let dy: number = targetPt.y - cy;

            let absDx: number = Math.abs(dx);
            let absDy: number = Math.abs(dy);

            let pt: cc.Vec2 = new cc.Vec2();

            if (absDx * target.height > absDy * target.width) {
                // 水平方向优先 - 连接左右边
                if (dx > 0) {
                    pt.x = target.x + target.width;  // 右边
                    pt.y = cy + (dy / absDx) * (target.width / 2);
                } else {
                    pt.x = target.x;  // 左边
                    pt.y = cy - (dy / absDx) * (target.width / 2);
                }
            } else {
                // 垂直方向优先 - 连接上下边
                if (dy > 0) {
                    pt.y = target.y + target.height;  // 上边
                    pt.x = cx + (dx / absDy) * (target.height / 2);
                } else {
                    pt.y = target.y;  // 下边
                    pt.x = cx - (dx / absDy) * (target.height / 2);
                }
            }

            // 限制点在target边界内
            pt.x = Math.max(target.x, Math.min(target.x + target.width, pt.x));
            pt.y = Math.max(target.y, Math.min(target.y + target.height, pt.y));

            // 应用偏移
            pt.x += offset.x;
            pt.y += offset.y;

            return pt;
        }

        /**
         * 获取连接点坐标（相对于父容器的本地坐标）
         */
        private getLinkerPoint(target: GObject, linkerType: LinkerType, offset: cc.Vec2): cc.Vec2 {
            let pt: cc.Vec2 = new cc.Vec2();

            switch (linkerType) {
                case LinkerType.Auto:
                case LinkerType.Center:
                    pt.x = target.x + target.width / 2;
                    pt.y = target.y + target.height / 2;
                    break;
                case LinkerType.Top:
                    pt.x = target.x + target.width / 2;
                    pt.y = target.y + target.height;
                    break;
                case LinkerType.Bottom:
                    pt.x = target.x + target.width / 2;
                    pt.y = target.y;
                    break;
                case LinkerType.Left:
                    pt.x = target.x;
                    pt.y = target.y + target.height / 2;
                    break;
                case LinkerType.Right:
                    pt.x = target.x + target.width;
                    pt.y = target.y + target.height / 2;
                    break;
                case LinkerType.TopLeft:
                    pt.x = target.x;
                    pt.y = target.y + target.height;
                    break;
                case LinkerType.TopRight:
                    pt.x = target.x + target.width;
                    pt.y = target.y + target.height;
                    break;
                case LinkerType.BottomLeft:
                    pt.x = target.x;
                    pt.y = target.y;
                    break;
                case LinkerType.BottomRight:
                    pt.x = target.x + target.width;
                    pt.y = target.y;
                    break;
            }

            // 应用偏移
            pt.x += offset.x;
            pt.y += offset.y;

            return pt;
        }

        /**
         * 绘制连线
         */
        private drawConnection(from: cc.Vec2, to: cc.Vec2): void {
            let ctx = this._graphics;
            ctx.lineWidth = this._lineWidth;
            ctx.strokeColor = this._lineColor;

            if (this._curve > 0) {
                // 贝塞尔曲线
                this.drawCurvedLine(ctx, from, to);
            } else if (this._dashed) {
                // 虚线
                this.drawDashedLine(ctx, from, to);
            } else {
                // 直线
                ctx.moveTo(from.x, -from.y);
                ctx.lineTo(to.x, -to.y);
            }

            ctx.stroke();

            // 绘制箭头
            if (this._showArrow) {
                this.drawArrow(to, from);
            }

            // 绘制起点/终点标记
            if (this._fromColor) {
                this.drawEndDot(from, this._fromColor);
            }
            if (this._toColor) {
                this.drawEndDot(to, this._toColor);
            }
        }

        /**
         * 绘制贝塞尔曲线
         */
        private drawCurvedLine(ctx: cc.Graphics, from: cc.Vec2, to: cc.Vec2): void {
            let dx: number = to.x - from.x;
            let dy: number = to.y - from.y;
            let dist: number = Math.sqrt(dx * dx + dy * dy);
            let controlOffset: number = dist * this._curve * 0.5;

            let cx1: number, cy1: number, cx2: number, cy2: number;

            if (Math.abs(dx) > Math.abs(dy)) {
                // 水平方向为主，控制点垂直偏移
                cx1 = from.x;
                cy1 = from.y + (dy > 0 ? controlOffset : -controlOffset);
                cx2 = to.x;
                cy2 = to.y + (dy > 0 ? -controlOffset : controlOffset);
            } else {
                // 垂直方向为主，控制点水平偏移
                cx1 = from.x + (dx > 0 ? controlOffset : -controlOffset);
                cy1 = from.y;
                cx2 = to.x + (dx > 0 ? -controlOffset : controlOffset);
                cy2 = to.y;
            }

            ctx.moveTo(from.x, -from.y);
            ctx.bezierCurveTo(cx1, -cy1, cx2, -cy2, to.x, -to.y);
        }

        /**
         * 绘制虚线
         */
        private drawDashedLine(ctx: cc.Graphics, from: cc.Vec2, to: cc.Vec2): void {
            let dx: number = to.x - from.x;
            let dy: number = to.y - from.y;
            let dist: number = Math.sqrt(dx * dx + dy * dy);

            if (dist <= 0) return;

            let ux: number = dx / dist; // 单位向量x
            let uy: number = dy / dist; // 单位向量y

            let drawn: number = 0;
            let toggle: boolean = true;

            ctx.moveTo(from.x, -from.y);

            while (drawn < dist) {
                let segLen: number = toggle ? this._dashLength : this._gapLength;
                if (drawn + segLen > dist) segLen = dist - drawn;

                let ex: number = from.x + (drawn + segLen) * ux;
                let ey: number = from.y + (drawn + segLen) * uy;

                if (toggle) {
                    ctx.lineTo(ex, -ey);
                } else {
                    ctx.moveTo(ex, -ey);
                }

                drawn += segLen;
                toggle = !toggle;
            }
        }

        /**
         * 绘制箭头
         */
        private drawArrow(tip: cc.Vec2, from: cc.Vec2): void {
            let ctx = this._graphics;
            let dx: number = tip.x - from.x;
            let dy: number = tip.y - from.y;
            let angle: number = Math.atan2(dy, dx);

            let arrowSize: number = this._arrowSize;
            let arrowAngle: number = Math.PI / 6; // 30度

            let x1: number = tip.x - arrowSize * Math.cos(angle - arrowAngle);
            let y1: number = tip.y - arrowSize * Math.sin(angle - arrowAngle);
            let x2: number = tip.x - arrowSize * Math.cos(angle + arrowAngle);
            let y2: number = tip.y - arrowSize * Math.sin(angle + arrowAngle);

            ctx.moveTo(tip.x, -tip.y);
            ctx.lineTo(x1, -y1);
            ctx.moveTo(tip.x, -tip.y);
            ctx.lineTo(x2, -y2);
            ctx.stroke();
        }

        /**
         * 绘制端点圆点
         */
        private drawEndDot(pt: cc.Vec2, color: cc.Color): void {
            let ctx = this._graphics;
            let oldColor: cc.Color = ctx.strokeColor;

            ctx.fillColor = color;
            ctx.strokeColor = color;

            ctx.circle(pt.x, -pt.y, this._lineWidth * 2.5);
            ctx.fill();
            ctx.stroke();

            ctx.strokeColor = oldColor;
        }

        // ============ 属性 ============

        public get node(): cc.Node {
            return this._node;
        }

        public get from(): GObject {
            return this._from;
        }

        public get to(): GObject {
            return this._to;
        }

        public get lineWidth(): number {
            return this._lineWidth;
        }

        public set lineWidth(value: number) {
            if (this._lineWidth != value) {
                this._lineWidth = value;
                this.markDirty();
            }
        }

        public get lineColor(): cc.Color {
            return this._lineColor;
        }

        public set lineColor(value: cc.Color) {
            this._lineColor.set(value);
            this.markDirty();
        }

        public get fromColor(): cc.Color {
            return this._fromColor;
        }

        public set fromColor(value: cc.Color) {
            if (value) {
                if (!this._fromColor) this._fromColor = new cc.Color();
                this._fromColor.set(value);
            } else {
                this._fromColor = null;
            }
            this.markDirty();
        }

        public get toColor(): cc.Color {
            return this._toColor;
        }

        public set toColor(value: cc.Color) {
            if (value) {
                if (!this._toColor) this._toColor = new cc.Color();
                this._toColor.set(value);
            } else {
                this._toColor = null;
            }
            this.markDirty();
        }

        public get fromOffset(): cc.Vec2 {
            return this._fromOffset;
        }

        public set fromOffset(value: cc.Vec2) {
            this._fromOffset.set(value);
            this.markDirty();
        }

        public get toOffset(): cc.Vec2 {
            return this._toOffset;
        }

        public set toOffset(value: cc.Vec2) {
            this._toOffset.set(value);
            this.markDirty();
        }

        public get visible(): boolean {
            return this._visible;
        }

        public set visible(value: boolean) {
            if (this._visible != value) {
                this._visible = value;
                this._node.active = value;
                this.markDirty();
            }
        }

        public get curve(): number {
            return this._curve;
        }

        /**
         * 设置曲线弯曲强度 (0=直线, (0-1]为贝塞尔曲线弯曲强度)
         */
        public set curve(value: number) {
            let v: number = Math.max(0, Math.min(1, value));
            if (this._curve != v) {
                this._curve = v;
                this.markDirty();
            }
        }

        public get dashed(): boolean {
            return this._dashed;
        }

        public set dashed(value: boolean) {
            if (this._dashed != value) {
                this._dashed = value;
                this.markDirty();
            }
        }

        public get dashLength(): number {
            return this._dashLength;
        }

        public set dashLength(value: number) {
            if (this._dashLength != value) {
                this._dashLength = Math.max(1, value);
                this.markDirty();
            }
        }

        public get gapLength(): number {
            return this._gapLength;
        }

        public set gapLength(value: number) {
            if (this._gapLength != value) {
                this._gapLength = Math.max(1, value);
                this.markDirty();
            }
        }

        public get showArrow(): boolean {
            return this._showArrow;
        }

        public set showArrow(value: boolean) {
            if (this._showArrow != value) {
                this._showArrow = value;
                this.markDirty();
            }
        }

        public get arrowSize(): number {
            return this._arrowSize;
        }

        public set arrowSize(value: number) {
            if (this._arrowSize != value) {
                this._arrowSize = value;
                this.markDirty();
            }
        }

        public get fromLinker(): LinkerType {
            return this._fromLinker;
        }

        public set fromLinker(value: LinkerType) {
            if (this._fromLinker != value) {
                this._fromLinker = value;
                this.markDirty();
            }
        }

        public get toLinker(): LinkerType {
            return this._toLinker;
        }

        public set toLinker(value: LinkerType) {
            if (this._toLinker != value) {
                this._toLinker = value;
                this.markDirty();
            }
        }

        /**
         * 销毁 - 清理所有资源和监听器
         */
        public destroy(): void {
            this.disconnect();
            if (this._scheduled) {
                cc.director.getScheduler().unschedule(this._doUpdateLine, this);
                this._scheduled = false;
            }
            if (this._node) {
                this._node.removeFromParent(true);
                this._node = null;
            }
            this._graphics = null;
        }
    }

    /**
     * 连接点类型
     * - Auto: 自动选择最近的边缘
     * - Center: 中心点
     * - Top/Bottom/Left/Right: 各边中点
     * - TopLeft/TopRight/BottomLeft/BottomRight: 四角
     */
    export enum LinkerType {
        Auto,       // 自动选择最近的边缘点
        Center,     // 中心
        Top,        // 上边中点
        Bottom,     // 下边中点
        Left,       // 左边中点
        Right,      // 右边中点
        TopLeft,    // 左上角
        TopRight,   // 右上角
        BottomLeft, // 左下角
        BottomRight // 右下角
    }
}