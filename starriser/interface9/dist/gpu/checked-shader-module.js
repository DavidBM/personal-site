/** Surface WGSL errors before pipeline creation replaces them with "invalid module". */
export async function createCheckedShaderModule(device, label, code) {
    const module = device.createShaderModule({ label, code });
    if (!module.getCompilationInfo)
        return module;
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) {
        throw new Error(errors.slice(0, 4).map(message => `${label}:${message.lineNum ?? 0}:${message.linePos ?? 0}: ${message.message}`).join('\n'));
    }
    return module;
}
//# sourceMappingURL=checked-shader-module.js.map