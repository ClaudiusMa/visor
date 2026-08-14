#!/usr/bin/env swift

import AppKit
import AVFoundation
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

guard CommandLine.arguments.count >= 4 else {
    fail("Usage: video-storyboard.swift <input.mp4> <output.jpg> <frame-count>")
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let frameCount = Int(CommandLine.arguments[3]), frameCount > 0, frameCount <= 24 else {
    fail("Frame count must be between 1 and 24")
}

let asset = AVURLAsset(url: inputURL)
let durationSeconds = CMTimeGetSeconds(asset.duration)
guard durationSeconds.isFinite, durationSeconds > 0 else {
    fail("Could not determine video duration: \(inputURL.path)")
}

let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.maximumSize = CGSize(width: 960, height: 640)
generator.requestedTimeToleranceBefore = CMTime(seconds: 0.08, preferredTimescale: 600)
generator.requestedTimeToleranceAfter = CMTime(seconds: 0.08, preferredTimescale: 600)

var frames: [(image: NSImage, seconds: Double)] = []
for index in 0..<frameCount {
    let seconds = durationSeconds * (Double(index) + 0.5) / Double(frameCount)
    let time = CMTime(seconds: seconds, preferredTimescale: 600)
    do {
        let cgImage = try generator.copyCGImage(at: time, actualTime: nil)
        frames.append((NSImage(cgImage: cgImage, size: .zero), seconds))
    } catch {
        fail("Could not extract frame at \(seconds)s: \(error)")
    }
}

guard !frames.isEmpty else { fail("No frames were extracted") }

let columns = min(3, frameCount)
let rows = Int(ceil(Double(frameCount) / Double(columns)))
let cellWidth: CGFloat = 420
let cellHeight: CGFloat = 280
let labelHeight: CGFloat = 28
let canvasSize = NSSize(width: CGFloat(columns) * cellWidth, height: CGFloat(rows) * (cellHeight + labelHeight))
let canvas = NSImage(size: canvasSize)

canvas.lockFocus()
NSColor(calibratedWhite: 0.08, alpha: 1).setFill()
NSRect(origin: .zero, size: canvasSize).fill()

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let labelAttributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.monospacedDigitSystemFont(ofSize: 14, weight: .medium),
    .foregroundColor: NSColor(calibratedWhite: 0.88, alpha: 1),
    .paragraphStyle: paragraph
]

for (index, frame) in frames.enumerated() {
    let column = index % columns
    let row = index / columns
    let x = CGFloat(column) * cellWidth
    let y = canvasSize.height - CGFloat(row + 1) * (cellHeight + labelHeight)
    let sourceSize = frame.image.size
    let scale = min(cellWidth / sourceSize.width, cellHeight / sourceSize.height)
    let drawSize = NSSize(width: sourceSize.width * scale, height: sourceSize.height * scale)
    let drawRect = NSRect(
        x: x + (cellWidth - drawSize.width) / 2,
        y: y + labelHeight + (cellHeight - drawSize.height) / 2,
        width: drawSize.width,
        height: drawSize.height
    )
    frame.image.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1)
    let label = String(format: "%.1fs", frame.seconds) as NSString
    label.draw(in: NSRect(x: x, y: y + 4, width: cellWidth, height: labelHeight), withAttributes: labelAttributes)
}

canvas.unlockFocus()

guard
    let tiff = canvas.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.86])
else {
    fail("Could not encode storyboard")
}

do {
    try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try jpeg.write(to: outputURL, options: .atomic)
    print(outputURL.path)
} catch {
    fail("Could not write storyboard: \(error)")
}

