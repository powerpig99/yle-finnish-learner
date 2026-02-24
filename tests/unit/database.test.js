/**
 * Database function tests using in-tree IndexedDB shim + node:test.
 */

const assert = require('node:assert/strict');
const { describe, test, beforeEach, afterEach } = require('node:test');

// Provide IndexedDB implementation in Node.js.
const { installIndexedDBShim } = require('../support/indexeddb-shim.js');
installIndexedDBShim(global);

// Keep test output focused on assertion results.
global.console = {
    ...console,
    error: () => {},
    warn: () => {},
    info: () => {},
};

// database.js uses conditional exports: CommonJS in Node.js, global functions in browser.
const {
    openDatabase,
    saveSubtitlesBatch,
    loadSubtitlesByMovieName,
    clearSubtitlesByMovieName,
    getMovieMetadata,
    upsertMovieMetadata,
    getAllMovieMetadata,
    deleteMovieMetadata,
    cleanupOldMovieData
} = require('../../database.js');

async function saveSubtitleRecord(db, movieName, targetLanguage, originalText, translatedText) {
    await saveSubtitlesBatch(db, [{
        movieName,
        originalLanguage: 'FI',
        targetLanguage,
        originalText,
        translatedText
    }]);
}

function deleteDB(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => {
            console.warn('Database deletion blocked');
            resolve();
        };
    });
}

describe('Database Functions', () => {
    let db;

    beforeEach(async () => {
        db = await openDatabase();
    });

    afterEach(async () => {
        if (db) {
            db.close();
        }
        await deleteDB('YleDualSubCache');
    });

    describe('openDatabase', () => {
        test('should open database successfully', async () => {
            assert.ok(db);
            assert.equal(db.name, 'YleDualSubCache');
            assert.equal(db.version, 3);
        });

        test('should have correct object stores', () => {
            assert.equal(db.objectStoreNames.contains('SubtitlesCache'), true);
            assert.equal(db.objectStoreNames.contains('MovieMetadata'), true);
        });
    });

    describe('save subtitle records and loadSubtitlesByMovieName', () => {
        test('should save and load a single subtitle', async () => {
            const movieName = 'Test Movie';
            const targetLanguage = 'EN-US';
            const originalText = 'hei maailma';
            const translatedText = 'hello world';

            await saveSubtitleRecord(db, movieName, targetLanguage, originalText, translatedText);
            const results = await loadSubtitlesByMovieName(db, movieName, targetLanguage);

            assert.equal(results.length, 1);
            assert.equal(results[0].movieName, movieName);
            assert.equal(results[0].originalLanguage, 'FI');
            assert.equal(results[0].targetLanguage, targetLanguage);
            assert.equal(results[0].originalText, originalText);
            assert.equal(results[0].translatedText, translatedText);
        });

        test('should save multiple subtitles for same movie', async () => {
            const movieName = 'Test Movie';
            const targetLanguage = 'EN-US';

            await saveSubtitleRecord(db, movieName, targetLanguage, 'hei', 'hello');
            await saveSubtitleRecord(db, movieName, targetLanguage, 'kiitos', 'thanks');
            await saveSubtitleRecord(db, movieName, targetLanguage, 'näkemiin', 'goodbye');

            const results = await loadSubtitlesByMovieName(db, movieName, targetLanguage);
            assert.equal(results.length, 3);
        });

        test('should return empty array for non-existent movie', async () => {
            const results = await loadSubtitlesByMovieName(db, 'Non-existent Movie', 'EN-US');
            assert.equal(results.length, 0);
        });

        test('should handle different target languages separately', async () => {
            const movieName = 'Test Movie';
            await saveSubtitleRecord(db, movieName, 'EN-US', 'hei', 'hello');
            await saveSubtitleRecord(db, movieName, 'VI', 'hei', 'xin chào');

            const englishResults = await loadSubtitlesByMovieName(db, movieName, 'EN-US');
            const vietnameseResults = await loadSubtitlesByMovieName(db, movieName, 'VI');

            assert.equal(englishResults.length, 1);
            assert.equal(englishResults[0].translatedText, 'hello');
            assert.equal(vietnameseResults.length, 1);
            assert.equal(vietnameseResults[0].translatedText, 'xin chào');
        });

        test('should update existing subtitle when saving with same key', async () => {
            const movieName = 'Test Movie';
            const targetLanguage = 'EN-US';
            const originalText = 'hei';

            await saveSubtitleRecord(db, movieName, targetLanguage, originalText, 'hello');
            await saveSubtitleRecord(db, movieName, targetLanguage, originalText, 'hi');

            const results = await loadSubtitlesByMovieName(db, movieName, targetLanguage);
            assert.equal(results.length, 1);
            assert.equal(results[0].translatedText, 'hi');
        });
    });

    describe('saveSubtitlesBatch', () => {
        test('should save multiple subtitles in a batch', async () => {
            const subtitles = [
                {
                    movieName: 'Movie 1',
                    originalLanguage: 'FI',
                    targetLanguage: 'EN-US',
                    originalText: 'hei',
                    translatedText: 'hello'
                },
                {
                    movieName: 'Movie 1',
                    originalLanguage: 'FI',
                    targetLanguage: 'EN-US',
                    originalText: 'kiitos',
                    translatedText: 'thanks'
                },
                {
                    movieName: 'Movie 1',
                    originalLanguage: 'FI',
                    targetLanguage: 'EN-US',
                    originalText: 'näkemiin',
                    translatedText: 'goodbye'
                }
            ];

            const savedCount = await saveSubtitlesBatch(db, subtitles);
            const results = await loadSubtitlesByMovieName(db, 'Movie 1', 'EN-US');

            assert.equal(savedCount, 3);
            assert.equal(results.length, 3);
        });

        test('should handle empty array', async () => {
            const savedCount = await saveSubtitlesBatch(db, []);
            assert.equal(savedCount, 0);
        });

        test('should save subtitles for different movies', async () => {
            const subtitles = [
                {
                    movieName: 'Movie 1',
                    originalLanguage: 'FI',
                    targetLanguage: 'EN-US',
                    originalText: 'hei',
                    translatedText: 'hello'
                },
                {
                    movieName: 'Movie 2',
                    originalLanguage: 'FI',
                    targetLanguage: 'EN-US',
                    originalText: 'hei',
                    translatedText: 'hello'
                }
            ];

            const savedCount = await saveSubtitlesBatch(db, subtitles);
            const movie1Results = await loadSubtitlesByMovieName(db, 'Movie 1', 'EN-US');
            const movie2Results = await loadSubtitlesByMovieName(db, 'Movie 2', 'EN-US');

            assert.equal(savedCount, 2);
            assert.equal(movie1Results.length, 1);
            assert.equal(movie2Results.length, 1);
        });
    });

    describe('clearSubtitlesByMovieName', () => {
        test('should delete all subtitles for a movie across all languages', async () => {
            const movieName = 'Test Movie';
            await saveSubtitleRecord(db, movieName, 'EN-US', 'hei', 'hello');
            await saveSubtitleRecord(db, movieName, 'VI', 'hei', 'xin chào');
            await saveSubtitleRecord(db, movieName, 'EN-US', 'kiitos', 'thanks');

            const deletedCount = await clearSubtitlesByMovieName(db, movieName);
            const englishResults = await loadSubtitlesByMovieName(db, movieName, 'EN-US');
            const vietnameseResults = await loadSubtitlesByMovieName(db, movieName, 'VI');

            assert.equal(deletedCount, 3);
            assert.equal(englishResults.length, 0);
            assert.equal(vietnameseResults.length, 0);
        });

        test('should not affect other movies', async () => {
            await saveSubtitleRecord(db, 'Movie 1', 'EN-US', 'hei', 'hello');
            await saveSubtitleRecord(db, 'Movie 2', 'EN-US', 'hei', 'hello');

            await clearSubtitlesByMovieName(db, 'Movie 1');
            const movie1Results = await loadSubtitlesByMovieName(db, 'Movie 1', 'EN-US');
            const movie2Results = await loadSubtitlesByMovieName(db, 'Movie 2', 'EN-US');

            assert.equal(movie1Results.length, 0);
            assert.equal(movie2Results.length, 1);
        });

        test('should return 0 when deleting non-existent movie', async () => {
            const deletedCount = await clearSubtitlesByMovieName(db, 'Non-existent Movie');
            assert.equal(deletedCount, 0);
        });
    });

    describe('Movie Metadata Functions', () => {
        describe('upsertMovieMetadata and getMovieMetadata', () => {
            test('should save and retrieve movie metadata', async () => {
                const movieName = 'Test Movie';
                const lastAccessedDays = 19000;

                await upsertMovieMetadata(db, movieName, lastAccessedDays);
                const metadata = await getMovieMetadata(db, movieName);

                assert.notEqual(metadata, null);
                assert.equal(metadata.movieName, movieName);
                assert.equal(metadata.lastAccessedDays, lastAccessedDays);
            });

            test('should update existing metadata', async () => {
                const movieName = 'Test Movie';

                await upsertMovieMetadata(db, movieName, 19000);
                await upsertMovieMetadata(db, movieName, 19100);
                const metadata = await getMovieMetadata(db, movieName);

                assert.equal(metadata.lastAccessedDays, 19100);
            });

            test('should return null for non-existent movie', async () => {
                const metadata = await getMovieMetadata(db, 'Non-existent Movie');
                assert.equal(metadata, null);
            });
        });

        describe('getAllMovieMetadata', () => {
            test('should retrieve all movie metadata', async () => {
                await upsertMovieMetadata(db, 'Movie 1', 19000);
                await upsertMovieMetadata(db, 'Movie 2', 19100);
                await upsertMovieMetadata(db, 'Movie 3', 19200);

                const allMetadata = await getAllMovieMetadata(db);
                assert.equal(allMetadata.length, 3);
            });

            test('should return empty array when no metadata exists', async () => {
                const allMetadata = await getAllMovieMetadata(db);
                assert.equal(allMetadata.length, 0);
            });
        });

        describe('deleteMovieMetadata', () => {
            test('should delete movie metadata', async () => {
                await upsertMovieMetadata(db, 'Test Movie', 19000);

                await deleteMovieMetadata(db, 'Test Movie');
                const metadata = await getMovieMetadata(db, 'Test Movie');

                assert.equal(metadata, null);
            });

            test('should not throw error when deleting non-existent metadata', async () => {
                await deleteMovieMetadata(db, 'Non-existent Movie');
            });
        });
    });

    describe('cleanupOldMovieData', () => {
        test('should cleanup old movies based on access time', async () => {
            const nowDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
            const oldMovieName = 'Old Movie';
            const recentMovieName = 'Recent Movie';

            await upsertMovieMetadata(db, oldMovieName, nowDays - 40);
            await saveSubtitleRecord(db, oldMovieName, 'EN-US', 'hei', 'hello');

            await upsertMovieMetadata(db, recentMovieName, nowDays - 10);
            await saveSubtitleRecord(db, recentMovieName, 'EN-US', 'hei', 'hello');

            const cleanedCount = await cleanupOldMovieData(db, 30);

            const oldMovieMetadata = await getMovieMetadata(db, oldMovieName);
            const recentMovieMetadata = await getMovieMetadata(db, recentMovieName);
            const oldMovieSubtitles = await loadSubtitlesByMovieName(db, oldMovieName, 'EN-US');
            const recentMovieSubtitles = await loadSubtitlesByMovieName(db, recentMovieName, 'EN-US');

            assert.equal(cleanedCount, 1);
            assert.equal(oldMovieMetadata, null);
            assert.notEqual(recentMovieMetadata, null);
            assert.equal(oldMovieSubtitles.length, 0);
            assert.equal(recentMovieSubtitles.length, 1);
        });

        test('should handle custom maxAgeDays parameter', async () => {
            const nowDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
            await upsertMovieMetadata(db, 'Movie 1', nowDays - 5);
            await upsertMovieMetadata(db, 'Movie 2', nowDays - 15);

            const cleanedCount = await cleanupOldMovieData(db, 10);
            assert.equal(cleanedCount, 1);
        });

        test('should return 0 when no old movies exist', async () => {
            const nowDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
            await upsertMovieMetadata(db, 'Recent Movie', nowDays);

            const cleanedCount = await cleanupOldMovieData(db, 30);
            assert.equal(cleanedCount, 0);
        });
    });
});
