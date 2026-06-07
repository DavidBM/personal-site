export function publishBusinessPublication(sink, publication) {
    sink.publish(publication.topic, publication.payload, publication.priority);
}
export function publishBusinessPublications(sink, publications) {
    for (const publication of publications) {
        publishBusinessPublication(sink, publication);
    }
}
//# sourceMappingURL=business-publications.js.map